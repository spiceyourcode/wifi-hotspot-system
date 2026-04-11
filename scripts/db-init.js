#!/usr/bin/env node
// scripts/db-init.js
// Applies the SQL schema to the configured database.
// Usage: node scripts/db-init.js
// Requires .env to be configured with DB credentials.

"use strict";

require("dotenv").config();
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔄 Connecting to MySQL as root to apply schema...");

  // Connect as root to create DB + user
  const rootConn = await mysql.createConnection({
    host: process.env.DB_HOST || "127.0.0.1",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: "root",
    password: process.env.MYSQL_ROOT_PASSWORD || "",
    multipleStatements: true,
  });

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");

  // Split on semicolons, filter blanks, run each statement
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  let count = 0;
  for (const stmt of statements) {
    try {
      await rootConn.query(stmt);
      count++;
    } catch (err) {
      // Skip "already exists" errors — schema is idempotent
      if (
        !err.message.includes("already exists") &&
        !err.message.includes("Duplicate")
      ) {
        console.error(`❌ SQL error: ${err.message}`);
        console.error(`   Statement: ${stmt.substring(0, 80)}...`);
      }
    }
  }

  await rootConn.end();
  console.log(`✅ Schema applied — ${count} statements executed`);
  console.log("   Tables: users, payments, sessions, provisioning_failures");
  console.log("   Views:  v_daily_revenue, v_active_sessions");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
