// server.js
// WiFi Hotspot Monetization System
// Usage: node server.js  |  pm2 start server.js --name hotspot-api

"use strict";

// ── Load env FIRST before any other require ──────────────────────────────
require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const logger = require("./services/logger");

const morgan = require("morgan");
const paymentRoutes = require("./routes/payment");
const callbackRoutes = require("./routes/callback");
const adminRoutes = require("./routes/admin");

const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// ── App setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// Trust the first proxy in front of the app (e.g. Nginx, Heroku, etc.)
// This is required for express-rate-limit to work correctly behind a proxy
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: false, // Disable CSP for testing to allow API calls
  }),
);

// ── CORS — Allow everything during testing ──────────────────────────
app.use(cors({ origin: "*", methods: "*" }));

// ── Body parsers ──────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

// ── Request logger ────────────────────────────────────────────────────────
app.use(morgan("combined"));

// ── Rate limiters ─────────────────────────────────────────────────────────
const defaultLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "20", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Slow down." },
});

// Tighter limit on the pay endpoint specifically
const payLimiter = rateLimit({
  windowMs: 60_000,
  max: 5, // max 5 STK pushes per minute per IP
  message: {
    success: false,
    message: "Too many payment attempts. Please wait a moment.",
  },
});

app.use(defaultLimiter);

// ── Static captive portal ─────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "portal")));

// Root → serve captive portal (express.static only matches exact paths)
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "portal", "login.html"));
});

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/pay", payLimiter, paymentRoutes);
app.use("/callback", callbackRoutes);
app.use("/admin", adminRoutes);

// Health check — used by Nginx, PM2, load balancers
app.get("/health", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: "Endpoint not found" });
});

// ── Global error handler ──────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  logger.info(
    `🚀 Hotspot API running on port ${PORT} [${process.env.NODE_ENV || "development"}]`,
  );
  logger.info(
    `   Base URL:      ${process.env.BASE_URL || `http://localhost:${PORT}`}`,
  );
  logger.info(`   Callback URL:  ${process.env.MPESA_CALLBACK_URL}`);
  logger.info(`   MikroTik:      ${process.env.MIKROTIK_HOST}`);
  logger.info(`   M-Pesa env:    ${process.env.MPESA_ENV}`);
});

module.exports = app;
