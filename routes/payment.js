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
          `INSERT INTO users (phone, mac_address, profile) VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE mac_address = VALUES(mac_address), profile = VALUES(profile)`,
          [normPhone, reqMac, pkg.profile],
        )
        .catch((e) =>
          logger.warn(`Could not sync MAC on payment: ${e.message}`),
        );
    }

    // Fire STK Push
    const stkResult = await initiateSTKPush(normPhone, pkg.amount, pkgKey);

    // Update with the real ID from Safaricom
    await db.execute(
      `UPDATE payments SET checkout_request_id = ? WHERE id = ?`,
      [stkResult.CheckoutRequestID, txnId],
    );

    res.json({
      success: true,
      message: "Payment initiated!",
      checkoutId: stkResult.CheckoutRequestID,
    });
  } catch (err) {
    logger.error(`❌ Payment failure: ${err.message}`);
    res.status(500).json({ success: false, message: "Payment error." });
  }
});

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

router.post("/trial", async (req, res) => {
  const { phone } = req.body;

  if (!phone || phone.length < 10) {
    return res.status(400).json({ success: false, message: "Phone required" });
  }

  let normPhone;
  try {
    normPhone = normalisePhone(phone);
  } catch (e) {
    return res.status(400).json({ success: false, message: "Invalid format" });
  }

  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const cleanIp = clientIp.replace(/^.*:/, "");
  let mac = req.body.mac;

  try {
    if (!mac) mac = await getMacByIp(cleanIp);
    if (!mac) {
      return res.status(400).json({ success: false, message: "ID failed." });
    }

    // Check recent trial
    const [existingPhone] = await db.execute(
      `SELECT id FROM payments WHERE phone = ? AND package_key = 'trial' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) LIMIT 1`,
      [normPhone],
    );
    if (existingPhone.length > 0 && process.env.NODE_ENV === "production") {
      return res.status(403).json({ success: false, message: "Used today." });
    }

    const [existingMac] = await db.execute(
      `SELECT phone FROM users WHERE mac_address = ? AND trial_used = 1 LIMIT 1`,
      [mac],
    );
    if (existingMac.length > 0 && process.env.NODE_ENV === "production") {
      return res.status(403).json({ success: false, message: "Device used." });
    }

    const profile = process.env.TRIAL_PROFILE || "trial";
    const duration = parseInt(process.env.TRIAL_DURATION_MINUTES || "3") * 60;

    await provisionUser(normPhone, profile, duration);

    await db.execute(
      `INSERT INTO payments (id, phone, amount, package_key, status) VALUES (UUID(), ?, 0, 'trial', 'completed')`,
      [normPhone],
    );

    await db.execute(
      `INSERT INTO users (phone, mac_address, profile, trial_used) VALUES (?, ?, ?, 1) 
       ON DUPLICATE KEY UPDATE mac_address = VALUES(mac_address), profile = VALUES(profile), trial_used = 1`,
      [normPhone, mac, profile],
    );

    return res.json({
      success: true,
      message: "Trial active!",
      username: normPhone,
    });
  } catch (err) {
    logger.error(`❌ Trial failure: ${err.message}`);
    res.status(500).json({ success: false, message: "Trial error." });
  }
});

module.exports = router;
