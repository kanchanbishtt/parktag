import https from "node:https";
import Razorpay from "razorpay";
import crypto from "node:crypto";

// Server-authoritative shop catalog (M15). Prices live here, NOT in the browser:
// the shop checkout sends only a productId, and the server resolves the amount it
// charges from this map — so a tampered client `amount` can never be trusted.
// Keep the ids/prices in sync with the shop UI (`frontend/pages/owner/welcome.html`).
// `tags` is how many physical stickers the pack contains. It is REAL DATA
// rather than something parsed back out of the display name, because
// order-linking.js uses it to decide how many activated stickers one order may
// hold, and "Pack of 2" is a string somebody will reword for marketing one day
// without ever thinking about the ledger.
export const SHOP_PRODUCTS = {
  "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amount: 299, tags: 1 },
  "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amount: 499, tags: 2 },
  // Two bike tags (front and back of one two-wheeler), same size as pt-car-2.
  //
  // soldOut is decided HERE, not on the storefronts. Each page used to carry
  // its own list of packs it would not sell, and the server sold them anyway:
  // an edited page, or a stale one, could pay for a pack nobody can ship. Now
  // every order route refuses a sold-out pack and the catalogue reports the
  // flag, so the pages follow the server. Remove the flag when stock lands.
  "pt-bike-1": { name: "ParkTag Bike Tag (Pack of 2)", amount: 499, tags: 2, soldOut: true },
  // One car tag and one bike tag.
  "pt-combo": { name: "ParkTag Combo Tag (Pack of 2)", amount: 499, tags: 2, soldOut: true },
  // "2 Cars" tier for the pack step: 4 car tags (both cars, front & back).
  "pt-car-4": { name: "ParkTag Car Tag (2 Cars · Pack of 4)", amount: 899, tags: 4 },
  // Combined SKUs for the "Choose your pack" step: a car pack + the optional
  // bike-tag add-on, which is the same pack of two as pt-bike-1 (+₹499).
  // Prices are the sum of the parts and stay server-authoritative — the
  // client sends only the SKU id, never a total.
  "pt-car-1-bike": { name: "ParkTag Car Tag (Pack of 1) + Bike Tag", amount: 798, tags: 3 },
  "pt-car-2-bike": { name: "ParkTag Car Tag (Pack of 2) + Bike Tag", amount: 998, tags: 4 },
  "pt-car-4-bike": { name: "ParkTag Car Tag (2 Cars · Pack of 4) + Bike Tag", amount: 1398, tags: 6 }
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

// The most packs one order may hold. Refused at every order route: without a
// ceiling a request for a million packs went all the way to Razorpay, which
// refused the amount and the buyer saw a bare "failed". A genuine bulk order
// above this is a conversation, not a checkout.
export const MAX_ORDER_QUANTITY = 20;

export function isRazorpayConfigured(env) {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
}

// One SDK instance per credential pair. The client holds a keep-alive
// connection pool, so building a fresh one per call meant a new TLS handshake
// to Razorpay on every order. Keyed on the pair, so rotating the keys (or a
// test pointing at other ones) gets a new client rather than a stale one.
const razorpayClients = new Map();

// The connection to Razorpay is kept open between calls.
//
// Creating an order is the slowest step of a checkout, and most of that was
// not Razorpay working: it was this server opening a fresh TCP and TLS
// connection to api.razorpay.com for every single order, which is three round
// trips before the request is even sent. Node's default agent drops an idle
// connection after five seconds, and orders arrive minutes apart, so in
// practice no order ever reused one.
//
// With this agent a connection stays open until Razorpay closes it, and
// warmRazorpay() below opens one a few seconds before it is needed.
const razorpayAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });

export function getRazorpay(env) {
  if (!isRazorpayConfigured(env)) return null;
  const cacheKey = `${env.razorpayKeyId}:${env.razorpayKeySecret}`;
  let client = razorpayClients.get(cacheKey);
  if (!client) {
    client = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
    // The SDK's own axios instance. If a future version moves it, this simply
    // does nothing and the SDK keeps its default behaviour.
    if (client.api?.rq?.defaults) client.api.rq.defaults.httpsAgent = razorpayAgent;
    razorpayClients.set(cacheKey, client);
  }
  return client;
}

// Open the connection to Razorpay before the order that needs it.
//
// Called when a buyer is about to pay (routes/shop: /api/shop/guest/warm). The
// request is the same read-only `GET /v1/orders?count=1` the boot check makes:
// it creates nothing, and its answer is not even read. What matters is that
// the TLS handshake is done, so create-order a moment later pays one round
// trip, not four.
//
// At most once every WARM_EVERY_MS per process: a connection that was just
// opened or used is still open, and a busy checkout must not turn into a
// stream of list requests. Never throws and never rejects.
const WARM_EVERY_MS = 20 * 1000;
let lastRazorpayWarmAt = 0;

export function warmRazorpay(env, { now = Date.now() } = {}) {
  const client = getRazorpay(env);
  const rq = client?.api?.rq;
  if (!rq || typeof rq.get !== "function") return false;
  if (now - lastRazorpayWarmAt < WARM_EVERY_MS) return false;
  lastRazorpayWarmAt = now;
  // A warm-up that fails changes nothing: the order opens its own connection.
  try {
    Promise.resolve(rq.get("/v1/orders", { params: { count: 1 }, timeout: 5000, validateStatus: () => true }))
      .catch(() => {});
  } catch { /* same */ }
  return true;
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
