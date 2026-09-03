import Razorpay from "razorpay";
import crypto from "node:crypto";

// Price of the official ParkTag physical sticker (INR). Centralised so future
// plans/tiers can be added without touching call sites.
export const STICKER_PRICE_INR = 199;

// Server-authoritative shop catalog (M15). Prices live here, NOT in the browser:
// the shop checkout sends only a productId, and the server resolves the amount it
// charges from this map — so a tampered client `amount` can never be trusted.
// Keep the ids/prices in sync with the shop UI (`frontend/pages/owner/welcome.html`).
export const SHOP_PRODUCTS = {
  "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amount: 299 },
  "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amount: 499 },
  "pt-bike-1": { name: "ParkTag Bike Tag", amount: 299 },
  "pt-combo": { name: "ParkTag Combo Pack", amount: 499 },
  // "2 Cars" tier for the pack step: 4 car tags (both cars, front & back).
  "pt-car-4": { name: "ParkTag Car Tag (2 Cars · Pack of 4)", amount: 899 },
  // Combined SKUs for the "Choose your pack" step: a car pack + the optional
  // bike-tag add-on (+₹299). Prices are the sum of the parts and stay
  // server-authoritative — the client sends only the SKU id, never a total.
  "pt-car-1-bike": { name: "ParkTag Car Tag (Pack of 1) + Bike Tag", amount: 598 },
  "pt-car-2-bike": { name: "ParkTag Car Tag (Pack of 2) + Bike Tag", amount: 798 },
  "pt-car-4-bike": { name: "ParkTag Car Tag (2 Cars · Pack of 4) + Bike Tag", amount: 1198 }
};

// Look up a shop product by id. Returns { id, name, amount } or null for an
// unknown id, so callers can 400 on anything not in the catalog.
//
// The lookup is an OWN-PROPERTY check, not a plain index, and the id must be a
// string. A bare `SHOP_PRODUCTS[productId]` also reaches everything on
// Object.prototype, so "constructor", "__proto__", "toString" and "valueOf" all
// returned something truthy and sailed past the caller's "Unknown product"
// check. What came back had no `amount`, so the price arithmetic produced NaN
// and /api/shop/place-cod wrote a real order for NaN rupees — which in
// production goes on to book a courier shipment with a broken
// cash-on-delivery figure, i.e. goods shipped for nothing.
//
// The typeof guard matters separately: JSON bodies can carry an array, and
// `SHOP_PRODUCTS[["pt-car-1"]]` coerces the array to the string "pt-car-1" and
// matches a real product.
export function getShopProduct(productId) {
  if (typeof productId !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(SHOP_PRODUCTS, productId)) return null;
  return { id: productId, ...SHOP_PRODUCTS[productId] };
}

export function isRazorpayConfigured(env) {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

export function getRazorpay(env) {
  if (!isRazorpayConfigured(env)) return null;
  return new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
}

// Turn the HTTP status of a credential probe into what should be logged.
//
// Split out from the network call so the decisions are testable without one,
// and so "unreachable" can never be reported as "your keys are wrong" — the
// distinction that decides whether someone goes and edits a live credential.
export function classifyRazorpayProbe(status) {
  if (status === 200) {
    return { ok: true, level: "info", message: "[razorpay] credentials verified against the live API" };
  }
  if (status === 401) {
    return {
      ok: false,
      level: "error",
      message:
        "[razorpay] AUTHENTICATION FAILED — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are set but Razorpay rejects them. " +
        "Every checkout will fail with \"Failed to create order. Please try again.\" until this is fixed. " +
        "Check the pair against the Razorpay dashboard, exactly, including character case."
    };
  }
  // Anything else is Razorpay being unhappy or unavailable, not a verdict on
  // the keys. Worth saying, not worth sending anyone to rotate a credential.
  return {
    ok: false,
    level: "warn",
    message: `[razorpay] credential check inconclusive (HTTP ${status}) — keys not verified this boot`
  };
}

// Prove at boot that the configured keys actually authenticate.
//
// WHY THIS EXISTS. The shop checkout was dead for five weeks and the app never
// said a word. RAZORPAY_KEY_ID had a trailing newline from a dashboard paste;
// later, retyping it by hand put the final character in the wrong case. Both
// are still non-empty strings, so `isRazorpayConfigured` was true, boot was
// clean, health checks were green — and the only symptom was a customer being
// told to try again, five weeks of them, while COD orders kept arriving and
// made the silence look normal.
//
// A read-only GET is enough to settle it: it exercises the same Basic auth
// header order creation uses, so it catches a bad id, a bad secret, whitespace,
// and a case typo alike. It creates nothing.
//
// Deliberately NOT fatal. A payment API that is briefly unreachable must not
// stop the site from serving the pages that have nothing to do with payment —
// and a hard exit on a network blip would be a self-inflicted outage on every
// deploy. The point is to make the failure loud and immediate, not to trade one
// silent outage for a noisier one.
export async function verifyRazorpayCredentials(env, log, { fetchImpl = fetch } = {}) {
  if (!isRazorpayConfigured(env)) return { ok: false, skipped: true };

  const auth = Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64");

  let status;
  try {
    const res = await fetchImpl("https://api.razorpay.com/v1/orders?count=1", {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(10000)
    });
    status = res.status;
  } catch (err) {
    log.warn({ err }, "[razorpay] could not reach the API to verify credentials — keys not checked this boot");
    return { ok: false, unreachable: true };
  }

  const verdict = classifyRazorpayProbe(status);
  log[verdict.level](verdict.message);
  return { ok: verdict.ok, status };
}

export async function createRazorpayOrder(env, { amount, receipt, notes }) {
  const rzp = getRazorpay(env);
  if (!rzp) throw new Error("Razorpay is not configured.");
  return rzp.orders.create({
    amount: Math.round(amount * 100), // paise
    currency: "INR",
    receipt,
    notes: notes || {}
  });
}

// Verify the Razorpay payment signature server-side (HMAC of order|payment).
export function verifyRazorpaySignature(env, { orderId, paymentId, signature }) {
  if (!env.razorpayKeySecret || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  // Constant-time compare to avoid signature timing leaks.
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
