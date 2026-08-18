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
