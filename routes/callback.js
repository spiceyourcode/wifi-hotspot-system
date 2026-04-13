// routes/callback.js
// POST /callback/mpesa — Safaricom Daraja calls this after payment completes
//
// SECURITY NOTE: This endpoint is public (no auth header from Daraja).
// We validate by:
//   1. Checking ResultCode
//   2. Matching CheckoutRequestID to a known pending record
//   3. Matching the paid amount to a valid package
//   4. Idempotency via mpesa_code unique index — prevents double-provisioning

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../config/db");
const { getPackageByAmount } = require("../config/packages");
const { provisionUser } = require("../services/mikrotik");
const logger = require("../services/logger");

/**
 * POST /callback/mpesa
 * Daraja payload structure (simplified):
 * {
 *   Body: {
 *     stkCallback: {
 *       MerchantRequestID: "...",
 *       CheckoutRequestID: "ws_CO_...",
 *       ResultCode: 0,          // 0 = success
 *       ResultDesc: "...",
 *       CallbackMetadata: {
 *         Item: [
 *           { Name: "Amount",              Value: 10 },
 *           { Name: "MpesaReceiptNumber",  Value: "QJK....." },
 *           { Name: "PhoneNumber",         Value: 254712345678 }
 *         ]
 *       }
 *     }
 *   }
 * }
 */
router.post("/mpesa", async (req, res) => {
  logger.info("📢 [M-PESA] CALLBACK RECEIVED! Checking payload...");

  // Always respond 200 immediately — Daraja retries if it gets non-2xx
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  // ── Parse callback body ─────────────────────────────────────────────────
  const callback = req.body?.Body?.stkCallback;
  if (!callback) {
    logger.warn("Callback received with unexpected structure");
    return;
  }

  const { CheckoutRequestID, ResultCode, ResultDesc } = callback;
  logger.info(
    `Callback CRQ:${CheckoutRequestID} ResultCode:${ResultCode} → ${ResultDesc}`,
  );

  // ── Verify the CheckoutRequestID is one we issued ───────────────────────
  const [paymentRows] = await db.execute(
    `SELECT id, phone, amount, package_key, status
     FROM payments
     WHERE checkout_request_id = ?
     LIMIT 1`,
    [CheckoutRequestID],
  );

  if (paymentRows.length === 0) {
    logger.warn(`Unknown CheckoutRequestID: ${CheckoutRequestID}`);
    return;
  }

  const payment = paymentRows[0];

  // Idempotency: skip if already processed
  if (payment.status !== "pending") {
    logger.info(
      `Duplicate callback for CRQ:${CheckoutRequestID} — already ${payment.status}`,
    );
    return;
  }

  // ── Handle failed payment ────────────────────────────────────────────────
  if (ResultCode !== 0) {
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [ResultDesc, payment.id],
    );
    logger.warn(`Payment failed for ${payment.phone}: ${ResultDesc}`);
    return;
  }

  // ── Extract metadata from successful payment ─────────────────────────────
  const items = callback.CallbackMetadata?.Item || [];
  const meta = {};
  for (const item of items) {
    meta[item.Name] = item.Value;
  }

  const paidAmount = meta["Amount"];
  const mpesaCode = meta["MpesaReceiptNumber"];
  const phoneFromMpesa = String(meta["PhoneNumber"]); // 254XXXXXXXXX

  if (!paidAmount || !mpesaCode) {
    logger.error(
      `Callback metadata missing for CRQ:${CheckoutRequestID}`,
      meta,
    );
    return;
  }

  // ── Validate amount matches a package ────────────────────────────────────
  const pkg = getPackageByAmount(paidAmount);
  if (!pkg) {
    logger.error(
      `No package matches paid amount KES ${paidAmount} for ${payment.phone}`,
    );
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [`Amount mismatch: KES ${paidAmount}`, payment.id],
    );
    return;
  }

  // ── Duplicate transaction guard (unique mpesa_code) ───────────────────────
  const [dupCheck] = await db.execute(
    `SELECT id FROM payments WHERE mpesa_code = ? LIMIT 1`,
    [mpesaCode],
  );
  if (dupCheck.length > 0) {
    logger.warn(`Duplicate M-Pesa code ${mpesaCode} — skipping`);
    return;
  }

  // ── Mark payment successful ───────────────────────────────────────────────
  await db.execute(
    `UPDATE payments
     SET status      = 'completed',
         mpesa_code  = ?,
         result_desc = ?,
         amount      = ?
     WHERE id = ?`,
    [mpesaCode, ResultDesc, paidAmount, payment.id],
  );

  logger.info(
    `Payment confirmed ${mpesaCode} KES ${paidAmount} → ${payment.phone} [${pkg.profile}]`,
  );

  // ── Upsert user in users table ────────────────────────────────────────────
  const [existingUser] = await db.execute(
    `SELECT id FROM users WHERE phone = ? LIMIT 1`,
    [payment.phone],
  );

  let userId;
  if (existingUser.length > 0) {
    userId = existingUser[0].id;
    await db.execute(
      `UPDATE users SET profile = ?, updated_at = NOW() WHERE id = ?`,
      [pkg.profile, userId],
    );
  } else {
    const [insertResult] = await db.execute(
      `INSERT INTO users (phone, profile) VALUES (?, ?)`,
      [payment.phone, pkg.profile],
    );
    userId = insertResult.insertId;
  }

  // ── Provision MikroTik user ───────────────────────────────────────────────
  try {
    const result = await provisionUser(
      payment.phone,
      pkg.profile,
      pkg.durationSec,
    );

    // Log session start
    await db.execute(
      `INSERT INTO sessions (user_id, login_time, package_key, mikrotik_profile)
       VALUES (?, NOW(), ?, ?)`,
      [userId, payment.package_key || pkg.profile, pkg.profile],
    );

    logger.info(
      `✅ User provisioned on MikroTik: ${payment.phone} [${result.action}] → ${pkg.profile}`,
    );
  } catch (err) {
    // Payment succeeded but MikroTik provisioning failed.
    // Log it — admin can manually provision or retry via /admin/provision endpoint.
    logger.error(
      `MikroTik provisioning failed for ${payment.phone}: ${err.message}`,
    );
    await db.execute(
      `INSERT INTO provisioning_failures (payment_id, phone, profile, error, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [payment.id, payment.phone, pkg.profile, err.message],
    );
  }
});

module.exports = router;
