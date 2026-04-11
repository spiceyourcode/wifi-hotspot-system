// config/packages.js
// Single source of truth for all internet packages.
// To add a new package, add an entry here — no other file needs changing.

"use strict";

/**
 * @typedef  {Object} Package
 * @property {string} name        - Display name shown to users
 * @property {number} amount      - Price in KES (must be exact M-Pesa amount)
 * @property {string} profile     - MikroTik hotspot profile name
 * @property {number} durationSec - Duration in seconds (used for session tracking)
 * @property {string} speed       - Human-readable speed limit (informational)
 * @property {string} description - Short description for the portal UI
 */

/** @type {Object.<string, Package>} */
const PACKAGES = {
  "1hr": {
    name: "1 Hour",
    amount: 10, // KES
    profile: "1hr", // must match MikroTik hotspot profile
    durationSec: 3600,
    speed: "2 Mbps",
    description: "Fast browsing for 1 hour",
  },
  "6hr": {
    name: "6 Hours",
    amount: 30,
    profile: "6hr",
    durationSec: 21600,
    speed: "2 Mbps",
    description: "Half-day unlimited browsing",
  },
  "24hr": {
    name: "24 Hours",
    amount: 50,
    profile: "24hr",
    durationSec: 86400,
    speed: "3 Mbps",
    description: "Full day access",
  },
  "7day": {
    name: "7 Days",
    amount: 200,
    profile: "7day",
    durationSec: 604800,
    speed: "4 Mbps",
    description: "Weekly unlimited bundle",
  },
};

/**
 * Look up a package by the exact KES amount paid via M-Pesa.
 * Returns null if no package matches (fraud / wrong amount guard).
 * @param {number} amount
 * @returns {Package|null}
 */
function getPackageByAmount(amount) {
  const pkg = Object.values(PACKAGES).find((p) => p.amount === amount);
  return pkg || null;
}

/**
 * Look up a package by its key (e.g. '1hr').
 * @param {string} key
 * @returns {Package|null}
 */
function getPackageByKey(key) {
  return PACKAGES[key] || null;
}

/**
 * Returns an array of packages suitable for rendering in the portal UI.
 * @returns {Array<{key: string, name: string, amount: number, speed: string, description: string}>}
 */
function listPackages() {
  return Object.entries(PACKAGES).map(([key, pkg]) => ({
    key,
    name: pkg.name,
    amount: pkg.amount,
    speed: pkg.speed,
    description: pkg.description,
  }));
}

module.exports = {
  PACKAGES,
  getPackageByAmount,
  getPackageByKey,
  listPackages,
};
