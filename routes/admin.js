// routes/admin.js
// Protected admin endpoints for operations/debugging
// Protect with IP allowlist or HTTP Basic Auth in production (Nginx)

"use strict";

const express = require("express");
const router = express.Router();

const db = require("../config/db");
const { getPackageByKey } = require("../config/packages");
const {
  provisionUser,
  removeUser,
  getUserStatus,
} = require("../services/mikrotik");
const logger = require("../services/logger");

// Simple bearer-token guard — set ADMIN_TOKEN in .env
router.use((req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
});

/**
 * POST /admin/provision
 * Manually retry MikroTik provisioning for a completed payment.
 * Body: { phone: "254712345678", package: "1hr" }
 */
router.post("/provision", async (req, res) => {
  const { phone, package: pkgKey } = req.body;
  const pkg = getPackageByKey(pkgKey);
  if (!pkg)
    return res.status(400).json({ success: false, message: "Invalid package" });

  try {
    const result = await provisionUser(phone, pkg.profile, pkg.durationSec);
    logger.info(`Admin manual provision: ${phone} → ${pkg.profile}`);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * DELETE /admin/user/:phone
 * Remove a hotspot user from MikroTik.
 */
router.delete("/user/:phone", async (req, res) => {
  try {
    const removed = await removeUser(req.params.phone);
    return res.json({ success: true, removed });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /admin/user/:phone/status
 * Check MikroTik active session for a user.
 */
router.get("/user/:phone/status", async (req, res) => {
  try {
    const status = await getUserStatus(req.params.phone);
    return res.json({ success: true, ...status });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * GET /admin/failures
 * List unresolved provisioning failures.
 */
router.get("/failures", async (_req, res) => {
  const [rows] = await db.execute(
    `SELECT * FROM provisioning_failures
     WHERE resolved = 0
     ORDER BY created_at DESC LIMIT 50`,
  );
  return res.json({ success: true, failures: rows });
});

/**
 * PATCH /admin/failures/:id/resolve
 */
router.patch("/failures/:id/resolve", async (req, res) => {
  await db.execute(
    `UPDATE provisioning_failures SET resolved = 1 WHERE id = ?`,
    [req.params.id],
  );
  return res.json({ success: true });
});

/**
 * GET /admin/payments?page=1&limit=20
 * Recent payment history.
 */
router.get("/payments", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.min(100, parseInt(req.query.limit || "20", 10));
  const offset = (page - 1) * limit;

  const [rows] = await db.execute(
    `SELECT id, phone, amount, package_key, mpesa_code, status, created_at
     FROM payments
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  const [[{ total }]] = await db.execute(
    `SELECT COUNT(*) AS total FROM payments`,
  );
  return res.json({ success: true, payments: rows, total, page, limit });
});

module.exports = router;
