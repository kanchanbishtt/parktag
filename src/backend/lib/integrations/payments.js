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
  "pt-car-1": { name: "ParkTag Car Tag (Pack of 1)", amount: 399 },
  "pt-car-2": { name: "ParkTag Car Tag (Pack of 2)", amount: 699 },
  "pt-bike-1": { name: "ParkTag Bike Tag", amount: 349 },
  "pt-combo": { name: "ParkTag Combo Pack", amount: 699 }
};

// Look up a shop product by id. Returns { id, name, amount } or null for an
// unknown id, so callers can 400 on anything not in the catalog.
export function getShopProduct(productId) {
  const product = SHOP_PRODUCTS[productId];
  return product ? { id: productId, ...product } : null;
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
