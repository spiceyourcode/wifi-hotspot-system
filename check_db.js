// check_db.js
require("dotenv").config();
const mysql = require("mysql2/promise");

async function check() {
  const rootConfig = {
    host: process.env.DB_HOST || "127.0.0.1",
    user: "root",
    password: process.env.MYSQL_ROOT_PASSWORD || "",
    database: process.env.DB_NAME || "hotspot_db",
  };

  const db = await mysql.createConnection(rootConfig);

  try {
    const [columns] = await db.execute("SHOW COLUMNS FROM users");
    const colNames = columns.map((c) => c.Field.toLowerCase());

    if (!colNames.includes("mac_address")) {
      console.log("Adding mac_address column...");
      await db.execute("ALTER TABLE users ADD COLUMN mac_address VARCHAR(20)");
    }

    if (!colNames.includes("trial_used")) {
      console.log("Adding trial_used column...");
      await db.execute(
        "ALTER TABLE users ADD COLUMN trial_used BOOLEAN DEFAULT 0",
      );
    }

    console.log("Database check/update complete.");
    await db.end();
    process.exit(0);
  } catch (err) {
    console.error("DB Error:", err.message);
    process.exit(1);
  }
}

check();
