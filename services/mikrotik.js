// services/mikrotik.js
// MikroTik RouterOS API integration using node-routeros
// Creates/removes/checks hotspot users programmatically

"use strict";

const RouterOSAPI = require("node-routeros").RouterOSAPI;
const logger = require("./logger");

// Connection config read from env
const ROUTER_CONFIG = {
  host: process.env.MIKROTIK_HOST || "192.168.88.1",
  port: parseInt(process.env.MIKROTIK_PORT || "8728", 10),
  user: process.env.MIKROTIK_USER || "admin",
  password: process.env.MIKROTIK_PASSWORD || "",
};

const HOTSPOT_SERVER = process.env.MIKROTIK_HOTSPOT_SERVER || "hotspot1";

/**
 * Get a connected RouterOS API client.
 * Always call .close() when done to release the TCP connection.
 * @returns {Promise<RouterOSAPI>}
 */
async function getClient() {
  const client = new RouterOSAPI(ROUTER_CONFIG);
  await client.connect();
  logger.debug(`RouterOS connected → ${ROUTER_CONFIG.host}`);
  return client;
}

/**
 * Safely close a RouterOS client, swallowing errors.
 * @param {RouterOSAPI} client
 */
async function closeClient(client) {
  try {
    await client.close();
  } catch (_) {
    /* ignore */
  }
}

/**
 * Create or update a hotspot user.
 * If a user with the same username already exists, their profile and
 * uptime-limit are updated (handles re-purchase / package upgrade).
 *
 * @param {string} phone    - Phone number used as both username & password
 * @param {string} profile  - MikroTik hotspot profile name (e.g. '1hr')
 * @param {number} durationSec - Session duration in seconds
 * @returns {Promise<{action: 'created'|'updated', username: string}>}
 */
async function provisionUser(phone, profile, durationSec) {
  const username = phone;
  const password = phone;
  console.log(`[MikroTik] Provisioning ${username} with profile ${profile}...`);
  const client = await getClient();
  console.log(`[MikroTik] Client connected to ${ROUTER_CONFIG.host}`);

  try {
    console.log(`[MikroTik] Checking for existing user ${username}...`);
    const existing = await client.write("/ip/hotspot/user/print", [
      `?name=${username}`,
    ]);
    console.log(`[MikroTik] Found ${existing.length} existing users.`);
    for (const u of existing) {
      console.log(`[MikroTik] Removing existing user ID: ${u[".id"]}`);
      await client.write("/ip/hotspot/user/remove", [`=.id=${u[".id"]}`]);
    }

    console.log(`[MikroTik] Checking for active sessions...`);
    const active = await client.write("/ip/hotspot/active/print", [
      `?user=${username}`,
    ]);
    for (const s of active) {
      console.log(`[MikroTik] Removing active session ID: ${s[".id"]}`);
      await client.write("/ip/hotspot/active/remove", [`=.id=${s[".id"]}`]);
    }

    console.log(`[MikroTik] Checking for host entries...`);
    const hosts = await client.write("/ip/hotspot/host/print", [
      `?user=${username}`,
    ]);
    for (const h of hosts) {
      console.log(`[MikroTik] Removing host entry ID: ${h[".id"]}`);
      await client.write("/ip/hotspot/host/remove", [`=.id=${h[".id"]}`]);
    }

    const uptime = formatUptime(durationSec);
    console.log(
      `[MikroTik] Adding fresh user ${username} (profile: ${profile}, uptime: ${uptime})...`,
    );
    await client.write("/ip/hotspot/user/add", [
      `=name=${username}`,
      `=password=${password}`,
      `=profile=${profile}`,
      `=limit-uptime=${uptime}`,
    ]);

    logger.info(`MikroTik user provisioned [FRESH]: ${username} → ${profile}`);
    return { action: "created", username };
  } catch (err) {
    console.error(`[MikroTik] Error during provisioning:`, err);
    throw err;
  } finally {
    await closeClient(client);
  }
}

/**
 * Remove a hotspot user and kick any active sessions.
 * Called on expiry or refund (optional workflow).
 * @param {string} phone
 * @returns {Promise<boolean>} true if user was found and removed
 */
async function removeUser(phone) {
  const client = await getClient();
  try {
    const existing = await client.write("/ip/hotspot/user/print", [
      `?name=${phone}`,
    ]);
    if (existing.length === 0) return false;

    await client.write("/ip/hotspot/user/remove", [
      `=.id=${existing[0][".id"]}`,
    ]);
    logger.info(`MikroTik user removed: ${phone}`);
    return true;
  } finally {
    await closeClient(client);
  }
}

/**
 * Check whether a user is currently active in a hotspot session.
 * @param {string} phone
 * @returns {Promise<{active: boolean, uptime?: string, address?: string}>}
 */
async function getUserStatus(phone) {
  const client = await getClient();
  try {
    const sessions = await client.write("/ip/hotspot/active/print", [
      `?user=${phone}`,
    ]);
    if (sessions.length === 0) return { active: false };

    const s = sessions[0];
    return { active: true, uptime: s.uptime, address: s.address };
  } finally {
    await closeClient(client);
  }
}

/**
 * Find the MAC address for a given IP status. Queries the RouterOS host table.
 * @param {string} ip
 * @returns {Promise<string|null>} MAC address (e.g. 00:AA:BB:CC:DD:EE)
 */
async function getMacByIp(ip) {
  const client = await getClient();
  try {
    const hosts = await client.write("/ip/hotspot/host/print", [
      `?address=${ip}`,
    ]);
    if (hosts.length === 0) return null;
    return hosts[0]["mac-address"];
  } finally {
    await closeClient(client);
  }
}

/**
 * Convert seconds into MikroTik uptime-limit format: HH:MM:SS
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

module.exports = {
  provisionUser,
  removeUser,
  getUserStatus,
  getClient,
  closeClient,
  getMacByIp,
};
