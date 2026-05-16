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
  if (!callback) return;

  const { CheckoutRequestID, ResultCode, ResultDesc } = callback;
  logger.info(`M-Pesa Callback ID:${CheckoutRequestID} Result:${ResultCode}`);

  const [paymentRows] = await db.execute(
    `SELECT id, phone, amount, package_key, status FROM payments WHERE checkout_request_id = ? LIMIT 1`,
    [CheckoutRequestID],
  );

  if (paymentRows.length === 0) {
    logger.warn(`Unknown CheckoutRequestID: ${CheckoutRequestID}`);
    return;
  }

  const payment = paymentRows[0];
  if (payment.status !== "pending") return;

  if (ResultCode !== 0) {
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [ResultDesc, payment.id],
    );
    return;
  }

  const items = callback.CallbackMetadata?.Item || [];
  const meta = {};
  for (const item of items) meta[item.Name] = item.Value;

  const paidAmount = meta["Amount"];
  const mpesaCode = meta["MpesaReceiptNumber"];

  const pkg = getPackageByAmount(paidAmount);
  if (!pkg) {
    await db.execute(
      `UPDATE payments SET status = 'failed', result_desc = ? WHERE id = ?`,
      [`Amount mismatch: ${paidAmount}`, payment.id],
    );
    return;
  }

  const [dupCheck] = await db.execute(
    `SELECT id FROM payments WHERE mpesa_code = ?`,
    [mpesaCode],
  );
  if (dupCheck.length > 0) return;

  try {
    await provisionUser(payment.phone, pkg.profile, pkg.durationSec);

    await db.execute(
      `UPDATE payments SET status = 'completed', mpesa_code = ?, result_desc = 'SUCCESS', amount = ? WHERE id = ?`,
      [mpesaCode, paidAmount, payment.id],
    );

    await db
      .execute(
        `INSERT INTO sessions (phone, status, package_key) VALUES (?, 'active', ?)`,
        [payment.phone, payment.package_key || pkg.profile],
      )
      .catch((e) => {});

    logger.info(`✅ Access Granted: ${payment.phone}`);
  } catch (err) {
    logger.error(`❌ Provisioning failure: ${err.message}`);
    await db.execute(
      `INSERT INTO provisioning_failures (payment_id, phone, profile, error) VALUES (?, ?, ?, ?)`,
      [payment.id, payment.phone, pkg.profile, err.message],
    );
  }
});

module.exports = router;
