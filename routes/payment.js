// routes/payment.js
// Logic for handling trial activations and initiating M-Pesa payments

"use strict";

const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { getPackageByKey } = require("../config/packages");
const {
  normalisePhone,
  initiateSTKPush,
  generateTransactionId,
} = require("../services/mpesa");
const { provisionUser, getMacByIp } = require("../services/mikrotik");
const logger = require("../services/logger");

/**
 * POST /pay
 * Initiates an M-Pesa payment for a data package.
 */
router.post("/", async (req, res) => {
  const { phone, package: pkgKey } = req.body;

  if (!phone || !pkgKey) {
    return res
      .status(400)
      .json({ success: false, message: "Phone and package are required" });
  }

  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid phone format" });
  }

  const pkg = getPackageByKey(pkgKey);
  if (!pkg) {
    return res.status(400).json({ success: false, message: "Invalid package" });
  }

  const txnId = generateTransactionId();

  try {
    logger.info(`Starting payment process for ${normPhone} [${pkgKey}]`);

    // Record initial payment attempt
    // Note: checkout_request_id will be filled after the STK push
    const [insResult] = await db.execute(
      `INSERT INTO payments (id, phone, amount, package_key, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [txnId, normPhone, pkg.amount, pkgKey],
    );

    // Bind MAC to user if provided (valuable for cloud identifying)
    const reqMac = req.body.mac;
    if (reqMac) {
      await db
        .execute(
          `INSERT INTO users (phone, mac_address) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE mac_address = VALUES(mac_address)`,
          [normPhone, reqMac],
        )
        .catch((e) =>
          logger.warn(`Could not sync MAC on payment: ${e.message}`),
        );
    }

    // ── Fire STK Push ──
    const stkResult = await initiateSTKPush(normPhone, pkg.amount, pkgKey);

    // ── Update with the real ID from Safaricom ──
    await db.execute(
      `UPDATE payments SET checkout_request_id = ? WHERE id = ?`,
      [stkResult.CheckoutRequestID, txnId],
    );

    logger.info(
      `STK Push sent → ${normPhone} [${pkgKey}] CRQ:${stkResult.CheckoutRequestID}`,
    );

    res.json({
      success: true,
      message: "Payment initiated! Check your phone for the M-Pesa prompt.",
      checkoutId: stkResult.CheckoutRequestID,
    });
  } catch (err) {
    logger.error(`❌ Payment initiation failure: ${err.message}`);
    res.status(500).json({
      success: false,
      message: "Payment system error. Please try again.",
    });
  }
});

/**
 * GET /status/:phone (mounted at /pay/status/:phone)
 */
router.get("/status/:phone", async (req, res) => {
  const { phone } = req.params;
  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    normPhone = phone;
  }

  try {
    const [rows] = await db.execute(
      `SELECT status, package_key FROM payments 
       WHERE (phone = ? OR phone = ?) AND status = 'completed' AND created_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)
       ORDER BY created_at DESC LIMIT 1`,
      [phone, normPhone],
    );

    if (rows.length > 0) {
      return res.json({ success: true, active: true, username: normPhone });
    }
    res.json({ success: true, active: false });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/**
 * POST /trial
 * Provisions a free 3-minute trial.
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
  const cleanIp = clientIp.replace(/^.*:/, "");
  let mac = req.body.mac; // Prefer MAC from portal handshake (Cloud compatible)

  logger.info(
    `Starting trial for ${phone} (IP: ${cleanIp}, MAC: ${mac || "PROBING"})`,
  );

  try {
    // Fallback to router lookup if portal didn't provide it (local mode)
    if (!mac) {
      mac = await getMacByIp(cleanIp);
      logger.info(`Resolved MAC via router probe: ${mac}`);
    }

    if (!mac) {
      logger.warn(`Hardware ID failed for IP: ${cleanIp}`);
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
        message: "You have already used your free trial for today.",
      });
    }

    // 2. Check if MAC has used a trial in 24h (Hardware Lock)
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
        message: "This device has already used its free trial.",
      });
    }

    const profile = process.env.TRIAL_PROFILE || "trial";
    const duration = parseInt(process.env.TRIAL_DURATION_MINUTES || "3") * 60;

    // ── Provision on Router ──
    logger.info(`Provisioning trial for ${normPhone} on MikroTik...`);
    await provisionUser(normPhone, profile, duration);

    // ── Update DB ──
    logger.info(`Recording trial in database for ${normPhone}...`);
    await db.execute(
      `INSERT INTO payments (id, phone, amount, package_key, status)
       VALUES (UUID(), ?, 0, 'trial', 'completed')`,
      [normPhone],
    );

    await db.execute(
      `INSERT INTO users (phone, mac_address, profile, trial_used) 
       VALUES (?, ?, ?, 1) 
       ON DUPLICATE KEY UPDATE 
         mac_address = VALUES(mac_address), 
         profile = VALUES(profile),
         trial_used = 1`,
      [normPhone, mac, profile],
    );

    logger.info(
      `✅ Trial activated successfully for ${normPhone} [MAC: ${mac}]`,
    );
    return res.json({
      success: true,
      message: "Trial activated! You have 3 minutes.",
      username: normPhone,
    });
  } catch (err) {
    logger.error(`❌ Trial failure for ${normPhone}: ${err.message}`, {
      stack: err.stack,
    });

    let userMsg = "Could not activate trial. Please try again.";
    if (err.errno === "SOCKTMOUT" || err.name === "RosException") {
      userMsg = "Router communication error. Please check router API status.";
    }

    res.status(500).json({ success: false, message: userMsg });
  }
});

module.exports = router;
