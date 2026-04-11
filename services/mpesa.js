// services/mpesa.js
// Safaricom Daraja API — OAuth token generation + STK Push
// Docs: https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate

'use strict';

const axios = require('axios');
const moment = require('moment');
const logger = require('./logger');

// ── Base URLs ───────────────────────────────────────────────────────────────
const BASE_URL =
  process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

// ── In-memory token cache ───────────────────────────────────────────────────
let _cachedToken  = null;
let _tokenExpires = 0;   // Unix timestamp (ms)

/**
 * Fetch (or return cached) Daraja OAuth2 access token.
 * Token is valid for 3600 s; we refresh 60 s early.
 * @returns {Promise<string>} Bearer token
 */
async function getAccessToken() {
  const now = Date.now();
  if (_cachedToken && now < _tokenExpires) return _cachedToken;

  const credentials = Buffer.from(
    `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
  ).toString('base64');

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: { Authorization: `Basic ${credentials}` },
      timeout: 10_000,
    }
  );

  _cachedToken  = data.access_token;
  _tokenExpires = now + (parseInt(data.expires_in, 10) - 60) * 1000;
  logger.debug('M-Pesa OAuth token refreshed');
  return _cachedToken;
}

/**
 * Build the base64 password required by the STK Push endpoint.
 * Format: Base64(Shortcode + Passkey + Timestamp)
 * @param {string} timestamp  - YYYYMMDDHHmmss
 * @returns {string}
 */
function buildPassword(timestamp) {
  const raw = `${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${timestamp}`;
  return Buffer.from(raw).toString('base64');
}

/**
 * Normalise phone number to 254XXXXXXXXX format.
 * Accepts: 07XXXXXXXX | 7XXXXXXXX | +254XXXXXXXXX | 254XXXXXXXXX
 * @param {string} phone
 * @returns {string}
 */
function normalisePhone(phone) {
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('254') && cleaned.length === 12) return cleaned;
  if (cleaned.startsWith('0')   && cleaned.length === 10) return `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7')   && cleaned.length === 9)  return `254${cleaned}`;
  throw new Error(`Invalid Kenyan phone number: ${phone}`);
}

/**
 * Initiate an M-Pesa STK Push (Lipa Na M-Pesa Online).
 *
 * @param {string} rawPhone   - User's phone number (any supported format)
 * @param {number} amount     - KES amount (integer)
 * @param {string} reference  - Account reference shown on M-Pesa prompt (max 12 chars)
 * @returns {Promise<{
 *   MerchantRequestID: string,
 *   CheckoutRequestID: string,
 *   ResponseCode: string,
 *   ResponseDescription: string,
 *   CustomerMessage: string
 * }>}
 */
async function initiateSTKPush(rawPhone, amount, reference = 'WiFi') {
  const phone     = normalisePhone(rawPhone);
  const timestamp = moment().format('YYYYMMDDHHmmss');
  const password  = buildPassword(timestamp);
  const token     = await getAccessToken();

  const payload = {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            Math.round(amount),         // M-Pesa requires integer
    PartyA:            phone,
    PartyB:            process.env.MPESA_SHORTCODE,
    PhoneNumber:       phone,
    CallBackURL:       process.env.MPESA_CALLBACK_URL,
    AccountReference:  reference.substring(0, 12), // max 12 chars
    TransactionDesc:   `WiFi - ${reference}`,
  };

  logger.info(`STK Push → ${phone} KES ${amount} [${reference}]`);

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  );

  if (data.ResponseCode !== '0') {
    throw new Error(`STK Push rejected: ${data.ResponseDescription}`);
  }

  return data;
}

/**
 * Query the status of an STK Push transaction.
 * Useful for polling if the callback is delayed.
 * @param {string} checkoutRequestId
 * @returns {Promise<Object>}
 */
async function querySTKStatus(checkoutRequestId) {
  const timestamp = moment().format('YYYYMMDDHHmmss');
  const password  = buildPassword(timestamp);
  const token     = await getAccessToken();

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      BusinessShortCode: process.env.MPESA_SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15_000,
    }
  );

  return data;
}

module.exports = { initiateSTKPush, querySTKStatus, normalisePhone };
