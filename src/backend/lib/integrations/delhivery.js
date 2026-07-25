// Delhivery integration for physical sticker fulfilment: pincode
// serviceability, shipment/waybill creation after payment, and tracking.
//
// API confidence notes (checked against https://delhivery-express-api-doc.readme.io):
//   - Pincode serviceability request/response: confirmed.
//   - Tracking request/response: confirmed.
//   - Order creation request payload (core required fields): confirmed from docs.
//   - Order creation RESPONSE shape (the `packages[].status/waybill` fields
//     this file reads): could not be confirmed from Delhivery's public docs —
//     built from the widely-used real-world shape. Test against the staging
//     environment (the default outside production) before relying on this
//     in production, and check the raw response logged on first real bookings.

export function isDelhiveryConfigured(env) {
  return Boolean(env.delhiveryApiKey && env.delhiveryPickupLocation);
}

function authHeaders(env) {
  return { Authorization: `Token ${env.delhiveryApiKey}` };
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { ok: response.ok, status: response.status, data };
}

// Returns { serviceable, cod, prepaid }. `serviceable` is `null` (not false)
// on any API/network failure — callers should fail OPEN on null so a
// Delhivery outage never blocks someone from saving an address or checking
// out; only an explicit "not serviceable" answer should block anything.
export async function checkPincodeServiceability(env, pincode) {
  if (!isDelhiveryConfigured(env)) return { serviceable: null, cod: null, prepaid: null };

  try {
    const url = `${env.delhiveryBaseUrl}/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pincode)}`;
    const { ok, data } = await getJson(url, authHeaders(env));
    // A non-2xx response (wrong base URL, auth failure, Delhivery outage) is
    // an UNKNOWN answer, not a "not serviceable" one — only a successful
    // response with no matching pincode entry means Delhivery genuinely
    // doesn't deliver there.
    if (!ok) return { serviceable: null, cod: null, prepaid: null, error: `HTTP ${data?.raw ? "non-JSON" : ""}`.trim() };
    const entry = data?.delivery_codes?.[0]?.postal_code;
    if (!entry) return { serviceable: false, cod: false, prepaid: false };
    return {
      serviceable: entry.pre_paid === "Y" || entry.cash === "Y",
      cod: entry.cash === "Y",
      prepaid: entry.pre_paid === "Y"
    };
  } catch (err) {
    return { serviceable: null, cod: null, prepaid: null, error: err.message };
  }
}

// Creates a single-piece Prepaid shipment (payment already collected via
// Razorpay before this runs) and returns the assigned waybill. Throws on
// failure — the caller decides how to handle a booking failure that happens
// after payment has already succeeded (see shop/index.js).
export async function createShipment(env, { orderId, address, productName }) {
  if (!isDelhiveryConfigured(env)) {
    throw new Error("Delhivery is not configured");
  }

  const payload = {
    pickup_location: { name: env.delhiveryPickupLocation },
    shipments: [
      {
        order: orderId,
        name: address.fullName,
        add: [address.line1, address.line2, address.landmark].filter(Boolean).join(", "),
        city: address.city,
        state: address.state,
        country: "India",
        phone: address.phone,
        pin: address.pincode,
        payment_mode: "Prepaid",
        products_desc: productName || "ParkTag sticker",
        quantity: "1",
        // A printed sticker + card mailer — small, light, fixed dimensions
        // regardless of product, so these are safe hardcoded ceilings rather
        // than something the checkout flow needs to collect from the buyer.
        weight: "50",
        shipment_width: "10",
        shipment_height: "1",
        shipment_length: "15",
        ...(env.delhiverySellerGstTin ? { seller_gst_tin: env.delhiverySellerGstTin } : {}),
        ...(env.delhiveryHsnCode ? { hsn_code: env.delhiveryHsnCode } : {})
      }
    ]
  };

  const body = `format=json&data=${encodeURIComponent(JSON.stringify(payload))}`;
  const response = await fetch(`${env.delhiveryBaseUrl}/api/cmu/create.json`, {
    method: "POST",
    headers: {
      ...authHeaders(env),
      "content-type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const pkg = Array.isArray(data?.packages) ? data.packages[0] : null;
  const waybill = pkg?.waybill;

  if (!response.ok || !waybill || pkg?.status === "Fail") {
    const remark =
      (Array.isArray(pkg?.remarks) ? pkg.remarks.join(", ") : pkg?.remarks) ||
      data?.rmk ||
      JSON.stringify(data);
    throw new Error(`Delhivery shipment creation failed: ${remark}`);
  }

  return { waybill, refnum: pkg.refnum || orderId, raw: data };
}

// Best-effort tracking lookup for dashboard display. Never throws — a
// tracking failure shouldn't break the owner dashboard, it should just show
// "status unavailable".
export async function trackShipment(env, waybill) {
  if (!isDelhiveryConfigured(env) || !waybill) return { status: null };

  try {
    const url = `${env.delhiveryBaseUrl}/api/v1/packages/json/?waybill=${encodeURIComponent(waybill)}`;
    const { ok, data } = await getJson(url, authHeaders(env));
    const shipment = data?.ShipmentData?.[0]?.Shipment;
    if (!ok || !shipment) return { status: null };
    return {
      status: shipment.Status?.Status || null,
      statusDateTime: shipment.Status?.StatusDateTime || null,
      instructions: shipment.Status?.Instructions || null
    };
  } catch (err) {
    return { status: null, error: err.message };
  }
}
