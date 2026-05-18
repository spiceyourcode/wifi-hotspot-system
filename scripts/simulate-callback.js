require("dotenv").config();
const db = require("../config/db");
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");

async function simulate() {
  const phone = "254708374149";
  const checkoutId = "ws_CO_SIMULATED_" + Date.now();
  const txnId = uuidv4();
  const amount = 10;
  const pkgKey = "1hr";

  console.log("1. Creating pending payment record...");
  await db.execute(
    "INSERT INTO payments (id, phone, amount, package_key, status, checkout_request_id) VALUES (?, ?, ?, ?, 'pending', ?)",
    [txnId, phone, amount, pkgKey, checkoutId],
  );

  console.log("2. Sending mock M-Pesa callback...");
  const callbackPayload = {
    Body: {
      stkCallback: {
        MerchantRequestID: "12345",
        CheckoutRequestID: checkoutId,
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: amount },
            { Name: "MpesaReceiptNumber", Value: "SIM" + Date.now() },
            { Name: "TransactionDate", Value: 20260517103000 },
            { Name: "PhoneNumber", Value: phone },
          ],
        },
      },
    },
  };

  try {
    const response = await axios.post(
      "http://localhost:3000/callback/mpesa",
      callbackPayload,
    );
    console.log("3. Callback response:", response.data);
  } catch (err) {
    console.error("3. Callback failed:", err.message);
    if (err.response) console.error("Data:", err.response.data);
  }

  console.log("4. Waiting for background processing (3s)...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  console.log("5. Verifying database state...");
  const [rows] = await db.execute(
    "SELECT status, mpesa_code FROM payments WHERE checkout_request_id = ?",
    [checkoutId],
  );
  console.log("   Payment status:", rows[0]?.status);

  console.log("Simulation complete. Check MikroTik for user:", phone);
  process.exit(0);
}

simulate().catch((err) => {
  console.error(err);
  process.exit(1);
});
