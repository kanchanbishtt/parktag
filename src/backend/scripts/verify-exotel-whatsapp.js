const BASE_URL = process.env.WAVETAG_VERIFY_BASE_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.WAVETAG_VERIFY_TOKEN || "";
const SCANNER_PHONE = process.env.WAVETAG_VERIFY_SCANNER_PHONE || "";
const MESSAGE =
  process.env.WAVETAG_VERIFY_MESSAGE ||
  "Hi, your vehicle is blocking my way. Please move it when possible.";

function fail(message) {
  throw new Error(message);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    fail(data.error || `Request failed: ${response.status}`);
  }

  return data;
}

async function main() {
  if (!TOKEN) {
    fail("Set WAVETAG_VERIFY_TOKEN before running verify-exotel-whatsapp");
  }

  if (!SCANNER_PHONE) {
    fail("Set WAVETAG_VERIFY_SCANNER_PHONE before running verify-exotel-whatsapp");
  }

  const request = await postJson(`${BASE_URL}/api/contact-requests`, {
    token: TOKEN,
    phone: SCANNER_PHONE,
    action: "message",
    messageChannel: "whatsapp",
    message: MESSAGE
  });

  console.log(JSON.stringify(request, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
