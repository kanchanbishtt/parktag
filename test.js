// Manual Exotel connect-call smoke test.
// SECURITY: credentials must come from environment variables — never hardcode
// API keys/tokens here. This file was previously committed with a live-looking
// Exotel API key/token/account SID hardcoded in source; if those were real,
// rotate them immediately in the Exotel dashboard.
const apiKey = process.env.EXOTEL_API_KEY;
const apiToken = process.env.EXOTEL_API_TOKEN;
const accountSid = process.env.EXOTEL_ACCOUNT_SID;
const fromNumber = process.env.EXOTEL_TEST_FROM_NUMBER;
const callerId = process.env.EXOTEL_CALLER_ID;

if (!apiKey || !apiToken || !accountSid || !fromNumber || !callerId) {
  throw new Error(
    "Set EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_ACCOUNT_SID, EXOTEL_TEST_FROM_NUMBER, and EXOTEL_CALLER_ID before running test.js"
  );
}

const url = `https://api.exotel.com/v1/Accounts/${accountSid}/Calls/connect`;

const params = new URLSearchParams({
  From: fromNumber,
  CallerId: callerId,
  Url: `http://my.exotel.com/${accountSid}/exoml/start_voice/1282960`,
  CallType: 'trans',
});

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'Authorization': 'Basic ' + Buffer.from(`${apiKey}:${apiToken}`).toString('base64'),
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: params,
});

console.log("HTTP Status:", response.status);
const text = await response.text();
console.log(text);
