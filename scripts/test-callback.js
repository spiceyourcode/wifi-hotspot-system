#!/usr/bin/env node
// scripts/test-callback.js
// Simulates a Safaricom Daraja callback for local development.
// Usage:
//   node scripts/test-callback.js <checkoutRequestId> [amount] [phone]
//
// Example (success):
//   node scripts/test-callback.js ws_CO_123456789 10 254712345678
//
// Example (failure — user cancelled):
//   node scripts/test-callback.js ws_CO_123456789 fail

"use strict";

const http = require("http");

const checkoutRequestId = process.argv[2];
const amountArg = process.argv[3] || "10";
const phoneArg = process.argv[4] || "254712345678";
const isFail = amountArg === "fail";

if (!checkoutRequestId) {
  console.error(
    "Usage: node scripts/test-callback.js <checkoutRequestId> [amount|fail] [phone]",
  );
  process.exit(1);
}

// Build a realistic Daraja callback payload
const payload = isFail
  ? {
      Body: {
        stkCallback: {
          MerchantRequestID: "test-merchant-id",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 1032,
          ResultDesc: "Request cancelled by user",
        },
      },
    }
  : {
      Body: {
        stkCallback: {
          MerchantRequestID: "test-merchant-id",
          CheckoutRequestID: checkoutRequestId,
          ResultCode: 0,
          ResultDesc: "The service request is processed successfully.",
          CallbackMetadata: {
            Item: [
              { Name: "Amount", Value: parseInt(amountArg, 10) },
              { Name: "MpesaReceiptNumber", Value: `QJK${Date.now()}` },
              { Name: "TransactionDate", Value: 20241201143000 },
              { Name: "PhoneNumber", Value: parseInt(phoneArg, 10) },
            ],
          },
        },
      },
    };

const body = JSON.stringify(payload);
const port = process.env.PORT || 3000;

const options = {
  hostname: "127.0.0.1",
  port,
  path: "/callback/mpesa",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  },
};

const req = http.request(options, (res) => {
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => {
    console.log(`\n📨 Callback sent to /callback/mpesa`);
    console.log(`   CheckoutRequestID : ${checkoutRequestId}`);
    console.log(
      `   Simulated result  : ${isFail ? "FAILED (user cancelled)" : `SUCCESS — KES ${amountArg} from ${phoneArg}`}`,
    );
    console.log(`\n📬 Server response (${res.statusCode}):`);
    try {
      console.log(JSON.parse(data));
    } catch {
      console.log(data);
    }
  });
});

req.on("error", (e) => {
  console.error("❌ Could not reach server:", e.message);
  console.error("   Is the server running on port", port, "?");
});

req.write(body);
req.end();
