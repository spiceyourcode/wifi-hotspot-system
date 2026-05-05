// server.js
// WiFi Hotspot Monetization System
"use strict";

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");
const logger = require("./services/logger");

const paymentRoutes = require("./routes/payment");
const callbackRoutes = require("./routes/callback");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

app.set("trust proxy", 1);

// ── Security & Middleware ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: "*", methods: "*" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(morgan("combined"));

// ── Rate Limiters ─────────────────────────────────────────────────────────
const defaultLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  message: { success: false, message: "Too many requests." },
});

const payLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {
    success: false,
    message: "Too many payment attempts. Please wait.",
  },
});

// ── Routes (Polling bypasses rate limit) ──────────────────────────────────
// Special bypass for status check to prevent 429 during polling
app.get("/pay/status/:phone", paymentRoutes);

// Apply global limit to everything else
app.use(defaultLimiter);

app.use("/pay", payLimiter, paymentRoutes);
app.use("/callback", callbackRoutes);
app.use("/admin", adminRoutes);

app.get("/", (req, res) =>
  res.json({ status: "online", service: "hotspot-api" }),
);

app.listen(PORT, "0.0.0.0", () => {
  logger.info(`🚀 Hotspot API running on port ${PORT} [production]`);
  logger.info(`   Base URL:      ${process.env.BASE_URL}`);
  logger.info(`   MikroTik API:  ${process.env.MIKROTIK_HOST}`);
});
