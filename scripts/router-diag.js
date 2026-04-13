#!/usr/bin/env node
// scripts/router-diag.js  — deep hotspot + portal diagnostics via API
"use strict";
require("dotenv").config();
const RouterOSAPI = require("node-routeros").RouterOSAPI;

const cfg = {
  host: process.env.MIKROTIK_HOST || "192.168.88.1",
  port: parseInt(process.env.MIKROTIK_PORT || "8728"),
  user: process.env.MIKROTIK_USER || "admin",
  password: process.env.MIKROTIK_PASSWORD || "",
};

async function run() {
  const c = new RouterOSAPI(cfg);
  await c.connect();
  console.log(`\n✅ Connected to ${cfg.host}\n`);

  // 1. DHCP leases — did phone get an IP?
  const leases = await c.write("/ip/dhcp-server/lease/print");
  console.log("── DHCP Leases ──────────────────────────────");
  if (leases.length === 0) {
    console.log("  ⚠️  NO leases — phone never got an IP from the router");
    console.log("     → Is DHCP server running? Check: /ip dhcp-server print");
  } else {
    leases.forEach((l) =>
      console.log(
        `  ${l.address}  ${l["mac-address"]}  ${l.status}  ${l["host-name"] || ""}`,
      ),
    );
  }

  // 2. Hotspot hosts — devices the hotspot has seen
  const hosts = await c.write("/ip/hotspot/host/print");
  console.log("\n── Hotspot Hosts (devices seen) ─────────────");
  if (hosts.length === 0) {
    console.log("  ⚠️  NO hosts seen by hotspot");
    console.log("     This means either:");
    console.log(
      "     a) Phone hasn't made any HTTP request yet (open browser!",
    );
    console.log("     b) Hotspot is not intercepting (profile issue)");
  } else {
    hosts.forEach((h) =>
      console.log(
        `  ${h.address}  mac=${h["mac-address"]}  auth=${h.authorized}  idle=${h.idle}`,
      ),
    );
  }

  // 3. Hotspot active sessions
  const active = await c.write("/ip/hotspot/active/print");
  console.log("\n── Active Hotspot Sessions ──────────────────");
  if (active.length === 0) {
    console.log("  ℹ️  No authenticated sessions");
  } else {
    active.forEach((s) =>
      console.log(`  ${s.user}  ${s.address}  uptime=${s.uptime}`),
    );
  }

  // 4. IP bindings (bypass list)
  const bindings = await c.write("/ip/hotspot/ip-binding/print");
  console.log("\n── Hotspot IP Bindings (bypass list) ────────");
  if (bindings.length === 0) {
    console.log("  ⚠️  NO ip-bindings — backend server is not bypassed!");
    console.log(
      "     Run: /ip hotspot ip-binding add address=192.168.88.253 type=bypassed",
    );
  } else {
    bindings.forEach((b) =>
      console.log(`  ${b.address}  type=${b.type}  ${b.comment || ""}`),
    );
  }

  // 5. Hotspot profile details
  const profiles = await c.write("/ip/hotspot/profile/print");
  console.log("\n── Hotspot Profile ──────────────────────────");
  profiles
    .filter((p) => p.name !== "default")
    .forEach((p) => {
      console.log(`  name=${p.name}`);
      console.log(`  hotspot-address=${p["hotspot-address"]}`);
      console.log(`  dns-name=${p["dns-name"]}`);
      console.log(`  login-by=${p["login-by"]}`);
      console.log(`  html-directory=${p["html-directory"]}`);
      console.log(`  http-proxy=${p["http-proxy"] || "none"}`);
    });

  // 6. DNS check
  const dns = await c.write("/ip/dns/print");
  console.log("\n── DNS Settings ─────────────────────────────");
  console.log(
    `  servers=${dns[0]?.servers}  allow-remote-requests=${dns[0]?.["allow-remote-requests"]}`,
  );
  if (dns[0]?.["allow-remote-requests"] !== "yes") {
    console.log(
      "  ⚠️  allow-remote-requests=no — phones CANNOT resolve DNS through router!",
    );
    console.log("     Run: /ip dns set allow-remote-requests=yes");
  } else {
    console.log(
      "  ✅ DNS remote requests allowed — phones can resolve domains",
    );
  }

  // 7. DHCP server status
  const dhcpServers = await c.write("/ip/dhcp-server/print");
  console.log("\n── DHCP Servers ─────────────────────────────");
  dhcpServers.forEach((s) => {
    const ok = s.disabled === "false";
    console.log(
      `  ${ok ? "✅" : "❌"} ${s.name}  interface=${s.interface}  disabled=${s.disabled}`,
    );
  });

  // 8. Wireless status
  const wireless = await c.write("/interface/wireless/print");
  console.log("\n── Wireless ─────────────────────────────────");
  wireless.forEach((w) => {
    const ok = w.disabled === "false";
    console.log(
      `  ${ok ? "✅" : "❌"} ${w.name}  ssid="${w.ssid}"  mode=${w.mode}  disabled=${w.disabled}`,
    );
  });

  console.log("\n── Quick Fix Commands (run in WinBox if needed) ──");
  if (!bindings.some((b) => b.type === "bypassed")) {
    console.log(
      '  /ip hotspot ip-binding add address=192.168.88.253 type=bypassed comment="Backend server"',
    );
  }
  if (dns[0]?.["allow-remote-requests"] !== "yes") {
    console.log("  /ip dns set allow-remote-requests=yes");
  }
  console.log("  ─────────────────────────────────────────────────\n");

  await c.close();
}

run().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
