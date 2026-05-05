// routes/callback.js
// POST /callback/mpesa — Safaricom Daraja calls this after payment completes

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../config/db");
const { getPackageByAmount } = require("../config/packages");
const { provisionUser } = require("../services/mikrotik");
const logger = require("../services/logger");

/**
 * POST /callback/mpesa
 */
router.post("/mpesa", async (req, res) => {
  logger.info("📢 [M-PESA] CALLBACK RECEIVED! Checking payload...");

  // Always respond 200 immediately to Safaricom
  res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });

  const callback = req.body?.Body?.stkCallback;
  if (!callback) {
    logger.warn("Callback received with unexpected structure");
    return;
  }

  const { CheckoutRequestID, ResultCode, ResultDesc } = callback;
  logger.info(
    `Callback ID:${CheckoutRequestID} Result:${ResultCode} -> ${ResultDesc}`,
  );

  // ── 1. Find the Pending Payment ──
  const [paymentRows] = await db.execute(
    `SELECT id, phone, amount, package_key, status
     FROM payments
     WHERE checkout_request_id = ?
     LIMIT 1`,
    [CheckoutRequestID],
  );

  if (paymentRows.length === 0) {
    logger.warn(`Rejected: Unknown CheckoutRequestID: ${CheckoutRequestID}`);
    return;
  }

  const payment = paymentRows[0];

  // Idempotency check
  if (payment.status !== "pending") {
    logger.info(`Ignored: Payment ${payment.id} is already ${payment.status}`);
    return;
  }

  // ── 2. Handle Failed Payment ──
  if (ResultCode !== 0) {
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [ResultDesc, payment.id],
    );
    logger.warn(`Failure: Payment failed for ${payment.phone}: ${ResultDesc}`);
    return;
  }

  // ── 3. Extract Metadata (Successful Case) ──
  const items = callback.CallbackMetadata?.Item || [];
  const meta = {};
  for (const item of items) {
    meta[item.Name] = item.Value;
  }

  const paidAmount = meta["Amount"];
  const mpesaCode = meta["MpesaReceiptNumber"];

  // ── 4. Verify Package ──
  const pkg = getPackageByAmount(paidAmount);
  if (!pkg) {
    logger.error(
      `Error: No package for amount KES ${paidAmount} [Phone: ${payment.phone}]`,
    );
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [`Amount mismatch: ${paidAmount}`, payment.id],
    );
    return;
  }

  // Double check code uniqueness
  const [dupCheck] = await db.execute(
    `SELECT id FROM payments WHERE mpesa_code = ?`,
    [mpesaCode],
  );
  if (dupCheck.length > 0) {
    logger.warn(`Alert: Duplicate Mpesa code ${mpesaCode} skipped.`);
    return;
  }

  // ── 5. Provision the Device! ──
  try {
    logger.info(
      `Provisioning ${payment.phone} on router for ${pkg.durationSec}s...`,
    );
    const result = await provisionUser(
      payment.phone,
      pkg.profile,
      pkg.durationSec,
    );

    // Update payment as COMPLETED
    await db.execute(
      `UPDATE payments
       SET status      = 'completed',
           mpesa_code  = ?,
           result_desc = 'SUCCESS',
           amount      = ?
       WHERE id = ?`,
      [mpesaCode, paidAmount, payment.id],
    );

    // Record session
    await db
      .execute(
        `INSERT INTO sessions (phone, status, package_key) VALUES (?, 'active', ?)`,
        [payment.phone, payment.package_key || pkg.profile],
      )
      .catch((e) => logger.warn(`Session log delay: ${e.message}`));

    logger.info(
      `✅ SUCCESS: ${payment.phone} is now online via ${pkg.profile}`,
    );
  } catch (err) {
    logger.error(`❌ PROVISION FAILURE for ${payment.phone}: ${err.message}`);

    // Store failure for manual retry
    await db.execute(
      `INSERT INTO provisioning_failures (payment_id, phone, profile, error, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [payment.id, payment.phone, pkg.profile, err.message],
    );
  }
});

module.exports = router;
