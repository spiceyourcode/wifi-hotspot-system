// routes/admin.js
// Admin dashboard logic — revenue stats & real-time hotspot monitoring

"use strict";

const express = require("express");
const router = express.Router();
const db = require("../config/db");
const { getClient, closeClient } = require("../services/mikrotik");
const logger = require("../services/logger");

// Simple Auth Middleware
const adminAuth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (authHeader === "Bearer hotspot-admin-secret-2024") {
    next();
  } else {
    res.status(401).json({ success: false, message: "Unauthorized" });
  }
};

/**
 * GET /admin/stats
 * Aggregated revenue and user counts
 */
router.get("/stats", adminAuth, async (req, res) => {
  try {
    const [[revenue]] = await db.execute(`
      SELECT 
        SUM(CASE WHEN created_at >= CURDATE() THEN amount ELSE 0 END) as today,
        SUM(CASE WHEN created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) THEN amount ELSE 0 END) as week,
        SUM(amount) as total
      FROM payments WHERE status = 'completed'
    `);

    const [[users]] = await db.execute(`SELECT COUNT(*) as count FROM users`);

    res.json({
      success: true,
      revenue: {
        today: Number(revenue.today || 0),
        week: Number(revenue.week || 0),
        total: Number(revenue.total || 0),
      },
      totalUsers: users.count,
    });
  } catch (err) {
    logger.error("Admin stats error:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /admin/payments
 * Recent transaction history
 */
router.get("/payments", adminAuth, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT phone, amount, package_key, status, created_at 
      FROM payments 
      ORDER BY created_at DESC LIMIT 50
    `);
    res.json({ success: true, payments: rows });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/**
 * GET /admin/active-users
 * Real-time list of MikroTik active sessions
 */
router.get("/active-users", adminAuth, async (req, res) => {
  let client;
  try {
    client = await getClient();
    const active = await client.write("/ip/hotspot/active/print");

    // Clean up response for dashboard
    const list = active.map((u) => ({
      user: u.user,
      address: u.address,
      mac: u["mac-address"],
      uptime: u.uptime,
      id: u[".id"],
    }));

    res.json({ success: true, activeUsers: list });
  } catch (err) {
    logger.error("MikroTik active users fetch failure:", err);
    res.status(500).json({ success: false, message: "Router API unreachable" });
  } finally {
    if (client) await closeClient(client);
  }
});

module.exports = router;
