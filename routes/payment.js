// routes/payment.js
// POST /pay — validate input, record pending payment, fire STK Push

"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();

const db = require("../config/db");
const { getPackageByKey, listPackages } = require("../config/packages");
const { initiateSTKPush, normalisePhone } = require("../services/mpesa");
const { provisionUser, getMacByIp } = require("../services/mikrotik");
const logger = require("../services/logger");

router.get("/packages", (_req, res) => {
  res.json({ success: true, packages: listPackages() });
});

/**
 * GET /status/check/:phone
 * Returns plan info if the user has an active/paid session.
 */
router.get("/admin/status/:phone", async (req, res) => {
  const { phone } = req.params;
  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    return res.json({ active: false });
  }

  const [rows] = await db.execute(
    `SELECT package_key, created_at FROM payments 
     WHERE phone = ? AND status = 'completed' 
       AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY created_at DESC LIMIT 1`,
    [normPhone],
  );

  if (rows.length === 0) return res.json({ active: false });

  // In a real prod environment, you'd check vs durationSec
  // For now, if they paid in last 7 days, we let them attempt a login (MikroTik will deny if limit reached)
  res.json({ active: true, package: rows[0].package_key });
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
router.post("/", async (req, res) => {
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
      username: normPhone,
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
 * GET /status/:checkoutRequestId
 */
router.get("/status/:checkoutRequestId", async (req, res) => {
  const { checkoutRequestId } = req.params;

  const [rows] = await db.execute(
    `SELECT status, package_key, amount, phone FROM payments
     WHERE checkout_request_id = ? LIMIT 1`,
    [checkoutRequestId],
  );

  if (rows.length === 0) {
    return res
      .status(404)
      .json({ success: false, message: "Transaction not found" });
  }

  return res.json({ success: true, ...rows[0], username: rows[0].phone });
});

/**
 * POST /trial
 * Provisions a free 3-minute trial.
 * Body: { phone: "07..." }
 */
router.post("/trial", async (req, res) => {
  const { phone } = req.body;

  if (!phone || phone.length < 10) {
    return res
      .status(400)
      .json({ success: false, message: "Valid phone number required" });
  }

  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid phone format" });
  }

  // Detect IP and lookup MAC
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  // Express usually returns ::ffff:192.168.88.x, clean it up
  const cleanIp = clientIp.replace(/^.*:/, "");

  try {
    const mac = await getMacByIp(cleanIp);
    if (!mac) {
      logger.warn(`Could not find MAC for IP: ${cleanIp}`);
      return res.status(400).json({
        success: false,
        message:
          "Network error: Could not identify your device. Please reconnect.",
      });
    }

    // 1. Check if PHONE has used a trial in 24h
    const [existingPhone] = await db.execute(
      `SELECT id FROM payments 
       WHERE phone = ? AND package_key = 'trial' 
       AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
       LIMIT 1`,
      [normPhone],
    );

    if (existingPhone.length > 0) {
      return res.status(403).json({
        success: false,
        message:
          "You have already used your free trial for today. Please purchase a package.",
      });
    }

    // 2. Check if MAC has used a trial in 24h (THE HARDENER)
    const [existingMac] = await db.execute(
      `SELECT phone FROM users WHERE mac_address = ? AND trial_used = 1 LIMIT 1`,
      [mac],
    );

    if (existingMac.length > 0) {
      logger.warn(
        `Trial block: MAC ${mac} tried another trial with ${normPhone}`,
      );
      return res.status(403).json({
        success: false,
        message:
          "This device has already used its free trial. Please purchase a package.",
      });
    }

    const profile = process.env.TRIAL_PROFILE || "trial";
    const duration = parseInt(process.env.TRIAL_DURATION_MINUTES || "3") * 60;

    // Record the trial
    await db.execute(
      `INSERT INTO payments (id, phone, amount, package_key, status)
       VALUES (UUID(), ?, 0, 'trial', 'completed')`,
      [normPhone],
    );

    // Bind MAC to user and mark trial used
    await db.execute(
      `INSERT INTO users (phone, mac_address, profile, trial_used) 
       VALUES (?, ?, ?, 1) 
       ON DUPLICATE KEY UPDATE 
         mac_address = VALUES(mac_address), 
         profile = VALUES(profile),
         trial_used = 1`,
      [normPhone, mac, profile],
    );

    await provisionUser(normPhone, profile, duration);

    logger.info(`Trial activated for ${normPhone} [MAC: ${mac}]`);
    return res.json({
      success: true,
      message: "Trial activated! You have 3 minutes.",
      username: normPhone,
    });
  } catch (err) {
    logger.error(`Trial failed: ${err.message}`);
    return res
      .status(500)
      .json({ success: false, message: "Could not activate trial" });
  }
});

module.exports = router;
