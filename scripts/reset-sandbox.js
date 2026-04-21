"use strict";
require("dotenv").config();
const mysql = require("mysql2/promise");

async function run() {
  const db = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "wifi_hotspot",
  });

  console.log("🛠️  SANDBOX RESET INITIATED...");

  try {
    // 1. Clear session logs
    await db.execute("DELETE FROM sessions");
    console.log(" ✅ Sessions cleared");

    // 2. Clear payment history (removes trial tracking)
    await db.execute("DELETE FROM payments");
    console.log(" ✅ Payments & trials cleared");

    // 3. Clear provisioning failures
    await db.execute("DELETE FROM provisioning_failures");
    console.log(" ✅ Error logs cleared");

    console.log("\n✨ DATABASE IS NOW FRESH. You can test Free Trials again!");
  } catch (err) {
    console.error("❌ Reset Failed:", err.message);
  } finally {
    await db.end();
  }
}
run();
