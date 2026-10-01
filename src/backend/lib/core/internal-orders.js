// Keeping our own testing out of our own revenue.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// Six orders sat in the shop ledger totalling Rs 2,443, and exactly one was a
// customer. The other five were Girish and Kanchan placing COD orders to their
// own Noida address to test the checkout. COD takes no money up front, so the
// books reported Rs 2,144 that does not exist and never will, and the daily
// digest would have kept reporting it every day.
//
// Nobody did anything wrong. A test order placed through production is
// genuinely indistinguishable from a customer order, which is why noticing has
// to be the system's job. Those five were caught only because somebody
// remembered there had been four customers.
//
// ── Why a phone list rather than a rule ────────────────────────────────────
//
// The alternative is "remember to flag test orders afterwards", and that is the
// rule that already failed. Recognising our own numbers costs nothing to
// maintain and asks nobody to think about bookkeeping at the exact moment they
// are thinking about whether the checkout works.
//
// ── It marks, it never blocks ──────────────────────────────────────────────
//
// A flagged order still books a courier, still mints a tag, still behaves
// exactly like a real one. The entire value of testing through production is
// that the test is real. Only the counting changes.

import { toE164 } from "./phone.js";

/**
 * Our own numbers, from configuration.
 *
 * Configuration rather than a constant for two reasons: a list of real mobile
 * numbers has no business in a public repository, and it changes whenever
 * somebody joins or leaves.
 */
export function internalPhoneList(env) {
  return String((env && env.internalTestPhones) || "")
    .split(",")
    .map((entry) => toE164(entry.trim()))
    .filter(Boolean);
}

/**
 * Is this order one of ours?
 *
 * Compared in E.164, because stored formats differ by signup path and a raw
 * string comparison would let a test placed from a "+91" form land straight
 * back in the revenue figure.
 *
 * FAILS OPEN. With no list configured nothing is internal, so every order
 * counts. That over-reports our own testing, which is visible and annoying.
 * Guessing the other way would under-report real revenue, and a customer's sale
 * quietly vanishing from the books is far worse than a test order appearing in
 * them.
 */
export function isInternalPhone(env, phone) {
  const number = toE164(phone);
  if (!number) return false;

  const ours = internalPhoneList(env);
  return ours.length > 0 && ours.includes(number);
}

// PT-Batch-002 is reserved for internal testing, including future stickers.
export function isInternalTag(tag) {
  return tag?.internal === true || tag?.batchNumber === "Batch-002";
}

// ── Keeping our own clicking out of our own analytics ──────────────────────
//
// The phone list above cleans the ledger. It did nothing for GA4, the Pixel or
// Clarity, which are fed by the browser: one morning of checkout testing
// produced two "purchases", 26 begin_checkouts and a 135-click session that
// accounted for most of that day's dead clicks. Two signals mark a browser as
// ours, and either is enough.

/**
 * Is this request from our own network?
 *
 * Exact addresses, not ranges: the office has one static line. Fails open
 * like the phone list, so an unset variable measures everybody.
 */
export function isInternalIp(env, ip) {
  const address = String(ip || "").replace(/^::ffff:/, "");
  if (!address) return false;

  return String((env && env.internalIps) || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .includes(address);
}

// Read by assets/analytics.js in the browser, so deliberately not httpOnly.
// It carries no secret: its only power is to switch measurement OFF.
export const INTERNAL_DEVICE_COOKIE = "pt_internal";

/**
 * Remember that this browser is one of ours.
 *
 * Called where an order is placed to one of our own numbers. From then on the
 * analytics bundle drops every event on this device, on a phone on mobile data
 * as much as on the office line, with nobody having to remember a setup step.
 * Scoped to the parent domain so the marketing site honours it too.
 */
export function markInternalDevice(reply, env, phone) {
  if (!isInternalPhone(env, phone)) return;

  const request = reply.request;
  const sharedDomain = /(^|\.)parktag\.me$/.test(request?.hostname || "");
  reply.setCookie(INTERNAL_DEVICE_COOKIE, "1", {
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
    sameSite: "lax",
    secure: request?.protocol === "https",
    ...(sharedDomain ? { domain: "parktag.me" } : {})
  });
}
