// config/db.js
// MySQL connection pool with auto-reconnect and graceful shutdown

"use strict";

const mysql = require("mysql2/promise");
const logger = require("../services/logger");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "3306", 10),
  user: process.env.DB_USER || "hotspot_user",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "hotspot_db",
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || "10", 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 30000,
  // Automatically parse date columns as JS Date objects
  dateStrings: false,
  timezone: "+03:00", // East Africa Time (EAT)
});

// Verify connectivity on startup
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    logger.info("✅ MySQL connection pool established");
    conn.release();
  } catch (err) {
    logger.error("❌ MySQL connection failed:", err.message);
    process.exit(1); // fatal — cannot run without DB
  }
}

testConnection();

// Graceful shutdown: drain pool when process exits
process.on("SIGINT", () => pool.end().then(() => process.exit(0)));
process.on("SIGTERM", () => pool.end().then(() => process.exit(0)));

module.exports = pool;
