#!/usr/bin/env node
// scripts/test-mikrotik-conn.js
// Runs a full connectivity + auth test against the MikroTik router.
// Usage: node scripts/test-mikrotik-conn.js
"use strict";

require("dotenv").config();
const net = require("net");
const RouterOSAPI = require("node-routeros").RouterOSAPI;

const HOST = process.env.MIKROTIK_HOST || "192.168.88.1";
const PORT = parseInt(process.env.MIKROTIK_PORT || "8728", 10);
const USER = process.env.MIKROTIK_USER || "admin";
const PASS = process.env.MIKROTIK_PASSWORD || "";
const HS = process.env.MIKROTIK_HOTSPOT_SERVER || "hotspot1";

console.log("\n========================================");
console.log(" MikroTik Connectivity Diagnostics");
console.log("========================================");
console.log(` Host    : ${HOST}`);
console.log(` Port    : ${PORT}`);
console.log(` User    : ${USER}`);
console.log(` HotSpot : ${HS}`);
console.log("========================================\n");

// ── Step 1: Raw TCP reachability ──────────────────────────────────────────
function testTCP() {
  return new Promise((resolve) => {
    console.log(`[1] TCP connect to ${HOST}:${PORT} ...`);
    const sock = new net.Socket();
    sock.setTimeout(4000);

    sock.connect(PORT, HOST, () => {
      console.log(
        `    ✅ TCP port ${PORT} is OPEN — router is reachable on LAN\n`,
      );
      sock.destroy();
      resolve(true);
    });

    sock.on("timeout", () => {
      console.log(`    ❌ TCP TIMEOUT — cannot reach ${HOST}:${PORT}`);
      console.log("       Possible reasons:");
      console.log("       • /ip service set api disabled=no  (run in WinBox)");
      console.log(
        "       • Firewall rule is blocking your IP — check rule #5 in WinBox:",
      );
      console.log("         /ip firewall filter print");
      console.log("       • Router not responding (ether4 cable issue?)\n");
      sock.destroy();
      resolve(false);
    });

    sock.on("error", (e) => {
      console.log(`    ❌ TCP ERROR: ${e.message}`);
      console.log("       → Check Ethernet 2 connection and router firewall\n");
      sock.destroy();
      resolve(false);
    });
  });
}

// ── Step 2: RouterOS API auth ─────────────────────────────────────────────
async function testAPIAuth() {
  console.log(`[2] RouterOS API login as "${USER}" ...`);
  const client = new RouterOSAPI({
    host: HOST,
    port: PORT,
    user: USER,
    password: PASS,
  });
  try {
    await client.connect();
    console.log(`    ✅ API LOGIN SUCCESSFUL — credentials are correct\n`);
    return client;
  } catch (err) {
    console.log(`    ❌ API LOGIN FAILED: ${err.message}`);
    console.log(`       → Check MIKROTIK_USER and MIKROTIK_PASSWORD in .env`);
    console.log(`       → User "${USER}" must exist on router: /user print\n`);
    return null;
  }
}

// ── Step 3: Hotspot status ────────────────────────────────────────────────
async function testHotspot(client) {
  console.log(`[3] Checking hotspot server "${HS}" ...`);
  try {
    const hs = await client.write("/ip/hotspot/print", [`?name=${HS}`]);
    if (hs.length === 0) {
      console.log(`    ❌ Hotspot "${HS}" NOT FOUND`);
      console.log(`       → Run in WinBox: /ip hotspot print`);
      console.log(`       → Then update MIKROTIK_HOTSPOT_SERVER in .env\n`);
    } else {
      const h = hs[0];
      console.log(
        `    ✅ Hotspot found: name="${h.name}" interface="${h.interface}" disabled="${h.disabled}"`,
      );
      if (h.disabled === "true") {
        console.log(
          `    ⚠️  Hotspot is DISABLED — run: /ip hotspot enable ${HS}`,
        );
      }
      console.log();
    }
  } catch (err) {
    console.log(`    ❌ Hotspot query failed: ${err.message}\n`);
  }
}

// ── Step 4: User profiles ─────────────────────────────────────────────────
async function testProfiles(client) {
  console.log("[4] Checking hotspot user profiles ...");
  try {
    const profiles = await client.write("/ip/hotspot/user/profile/print");
    const names = profiles.map((p) => p.name).join(", ");
    const required = ["trial", "1hr", "6hr", "24hr", "7day"];
    const missing = required.filter((r) => !profiles.find((p) => p.name === r));

    console.log(`    Found profiles: ${names}`);
    if (missing.length > 0) {
      console.log(`    ⚠️  Missing profiles: ${missing.join(", ")}`);
      console.log(
        `       → Re-run the mikrotik-setup-v2.rsc script in WinBox\n`,
      );
    } else {
      console.log(
        `    ✅ All required profiles (trial, 1hr, 6hr, 24hr, 7day) exist\n`,
      );
    }
  } catch (err) {
    console.log(`    ❌ Profile query failed: ${err.message}\n`);
  }
}

// ── Step 5: Current active hotspot users ──────────────────────────────────
async function testActiveUsers(client) {
  console.log("[5] Checking active hotspot sessions ...");
  try {
    const active = await client.write("/ip/hotspot/active/print");
    if (active.length === 0) {
      console.log(
        "    ℹ️  No active sessions (no phone currently logged in)\n",
      );
    } else {
      console.log(`    Active sessions (${active.length}):`);
      active.forEach((s) => {
        console.log(
          `      • ${s.user} | IP: ${s.address} | Uptime: ${s.uptime}`,
        );
      });
      console.log();
    }
  } catch (err) {
    console.log(`    ❌ Active users query failed: ${err.message}\n`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const tcpOk = await testTCP();
  if (!tcpOk) {
    console.log("========================================");
    console.log(" ❌ CANNOT REACH ROUTER — STOP HERE");
    console.log("    Fix TCP connectivity first:");
    console.log("    1. Is ether4 cable plugged in?");
    console.log("    2. Run in WinBox: /ip service set api disabled=no");
    console.log("    3. /ip firewall filter print — check your IP is allowed");
    console.log(`       Your IP: 192.168.88.253`);
    console.log("========================================\n");
    process.exit(1);
  }

  const client = await testAPIAuth();
  if (!client) {
    console.log("========================================");
    console.log(" ❌ AUTH FAILED — STOP HERE");
    console.log("========================================\n");
    process.exit(1);
  }

  await testHotspot(client);
  await testProfiles(client);
  await testActiveUsers(client);

  try {
    await client.close();
  } catch (_) {}

  console.log("========================================");
  console.log(" ✅ ALL CHECKS PASSED");
  console.log("    Backend ↔ MikroTik communication: OK");
  console.log("    You can now plug in WAN1 and test");
  console.log("    the full payment → provisioning flow.");
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
