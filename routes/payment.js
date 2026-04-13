// routes/payment.js
// POST /pay — validate input, record pending payment, fire STK Push

"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const db = require("../config/db");
const { getPackageByKey, listPackages } = require("../config/packages");
const { initiateSTKPush, normalisePhone } = require("../services/mpesa");
const { provisionUser } = require("../services/mikrotik");
const logger = require("../services/logger");

/**
 * GET /packages
 * Returns all available packages — consumed by the captive portal UI.
 */
router.get("/packages", (_req, res) => {
  res.json({ success: true, packages: listPackages() });
});

/**
 * POST /pay
 * Body: { phone: "0712345678", package: "1hr" }
 *
 * 1. Validates phone + package
 * 2. Guards against duplicate pending transactions (same phone in last 2 min)
 * 3. Inserts a PENDING payment record
 * 4. Fires STK Push
 * 5. Returns checkout request ID for frontend polling
 */
router.post("/pay", async (req, res) => {
  const { phone, package: pkgKey } = req.body;

  // ── Input validation ────────────────────────────────────────────────────
  if (!phone || !pkgKey) {
    return res
      .status(400)
      .json({ success: false, message: "Phone and package are required" });
  }

  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }

  const pkg = getPackageByKey(pkgKey);
  if (!pkg) {
    return res.status(400).json({
      success: false,
      message: `Invalid package. Available: ${listPackages()
        .map((p) => p.key)
        .join(", ")}`,
    });
  }

  // ── Duplicate-pending guard (2-minute window) ───────────────────────────
  const [pendingRows] = await db.execute(
    `SELECT id FROM payments
     WHERE phone = ? AND status = 'pending'
       AND created_at > DATE_SUB(NOW(), INTERVAL 2 MINUTE)
     LIMIT 1`,
    [normPhone],
  );
  if (pendingRows.length > 0) {
    return res.status(429).json({
      success: false,
      message:
        "A payment is already pending for this number. Please wait ~2 minutes.",
    });
  }

  // ── Insert pending record ───────────────────────────────────────────────
  const txnId = uuidv4();
  await db.execute(
    `INSERT INTO payments (id, phone, amount, package_key, status)
     VALUES (?, ?, ?, ?, 'pending')`,
    [txnId, normPhone, pkg.amount, pkgKey],
  );

  // ── Fire STK Push ───────────────────────────────────────────────────────
  try {
    const stkResult = await initiateSTKPush(normPhone, pkg.amount, pkgKey);

    // Store the CheckoutRequestID so we can match the callback
    await db.execute(
      `UPDATE payments SET checkout_request_id = ? WHERE id = ?`,
      [stkResult.CheckoutRequestID, txnId],
    );

    logger.info(
      `STK Push sent → ${normPhone} KES ${pkg.amount} [${pkgKey}] CRQ:${stkResult.CheckoutRequestID}`,
    );

    return res.json({
      success: true,
      message: `Payment prompt sent to ${phone}. Enter your M-Pesa PIN.`,
      checkoutRequestId: stkResult.CheckoutRequestID,
      amount: pkg.amount,
      package: pkg.name,
    });
  } catch (err) {
    // Roll back pending record on STK failure
    await db.execute(`UPDATE payments SET status = 'failed' WHERE id = ?`, [
      txnId,
    ]);
    logger.error(`STK Push failed for ${normPhone}: ${err.message}`);

    return res.status(502).json({
      success: false,
      message: "Could not send payment prompt. Please try again.",
    });
  }
});

/**
 * GET /pay/status/:checkoutRequestId
 * Frontend polls this to know when payment succeeds without relying solely on
 * the Daraja callback (which may be delayed in sandbox mode).
 */
router.get("/pay/status/:checkoutRequestId", async (req, res) => {
  const { checkoutRequestId } = req.params;

  const [rows] = await db.execute(
    `SELECT status, package_key, amount FROM payments
     WHERE checkout_request_id = ? LIMIT 1`,
    [checkoutRequestId],
  );

  if (rows.length === 0) {
    return res
      .status(404)
      .json({ success: false, message: "Transaction not found" });
  }

  return res.json({ success: true, ...rows[0] });
});

/**
 * POST /trial
 * Provisions a free 3-minute trial.
 * Body: { phone: "07..." }
 */
router.post("/trial", async (req, res) => {
  const { phone } = req.body;
  if (!phone) {
    return res.status(400).json({ success: false, message: "Phone required" });
  }

  try {
    const profile = process.env.TRIAL_PROFILE || "trial";
    const duration = parseInt(process.env.TRIAL_DURATION_MINUTES || "3") * 60;

    await provisionUser(phone, profile, duration);

    logger.info(`Trial provisioned for ${phone}`);
    return res.json({
      success: true,
      message: "Trial activated! You have 3 minutes.",
    });
  } catch (err) {
    logger.error(`Trial failed: ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Could not activate trial" });
  }
});

module.exports = router;
