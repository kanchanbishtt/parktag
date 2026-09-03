// ── Private document vault ─────────────────────────────────────────────────
//
// Owners keep soft copies of their vehicle paperwork here — RC, insurance, PUC,
// driving licence — so they are reachable at a police stop or after an accident
// without digging through the glovebox.
//
// OWNER-ONLY, deliberately. Nothing in this module is reachable from a tag
// scan: every route that uses it sits behind an owner session AND a re-entered
// PIN. Someone who scans a parked car's QR gets the existing masked-contact
// flow and no hint that documents exist at all. That is the whole security
// model — a scannable document store would turn a parking tag into a way to
// harvest identity documents off any car in a car park.
//
// The PIN is a SECOND factor over the login session, not a password: the threat
// it answers is an unlocked, unattended phone that is already signed in. It is
// short by design, so the brute-force defence is the lockout below rather than
// the digit count.

import crypto from "node:crypto";
import { Transform } from "node:stream";

import { createPasswordHash, verifyPassword } from "../auth/security.js";
import {
  getLoginLock,
  recordLoginFailure,
  clearLoginFailures
} from "../auth/login-lockout.js";
import { hasActiveSubscription } from "./subscription.js";
import { addMonths } from "./calendar.js";

// Reuses the per-account lockout that already guards sign-in, keyed under its
// own "vault" role so vault guesses and login guesses never share a counter —
// failing your PIN must not lock you out of the app itself, and vice versa.
const LOCKOUT_ROLE = "vault";

// How long one PIN entry keeps the vault open. Long enough to upload a few
// documents or show a policeman two of them, short enough that a phone left on
// a table re-locks on its own.
const GRANT_TTL_MS = 15 * 60 * 1000;

const PIN_MIN_DIGITS = 4;
const PIN_MAX_DIGITS = 8;

// Storage ceilings. These are not arbitrary: the files live in GridFS, i.e. in
// the same Atlas cluster as everything else, where storage is tier-capped and
// far dearer per GB than object storage. A phone photo of an RC is 2-5MB, so
// without a ceiling a few hundred owners would fill the cluster and take the
// whole app down with them. Revisit these if the vault ever moves to S3/R2.
export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB per document
export const MAX_BYTES_PER_OWNER = 40 * 1024 * 1024; // 40MB across all vehicles

// ── How many documents one vehicle may hold ────────────────────────────────
//
// The allowance belongs to the TAG, not the account, exactly as `premium`,
// `contactAvailable` and `freeContactUsed` already do. It is the sticker that
// was paid for, so a premium tag on one car does not enlarge the vault of an
// E-Tag on another.
//
// Three tiers:
//
//   E-Tag                    1 document   — enough to keep the RC to hand, so
//                                           the feature is real rather than a
//                                           locked door, and small enough that
//                                           free vehicles cannot fill GridFS.
//   Premium tag              3 documents  — RC, insurance and PUC, which is the
//                                           set an owner is actually asked for.
//   Premium, first year      the lot      — buying a premium tag includes the
//                                           subscription tier free for a year,
//                                           so the add-on is something an owner
//                                           has used before being asked to pay
//                                           for it.
//   Premium + subscription   the lot      — the paid add-on. See
//                                           hasActiveDocumentSubscription: the
//                                           entitlement is read here, but
//                                           nothing SELLS it yet, so today this
//                                           tier is only reachable by stamping
//                                           the field directly.
//
// The per-owner BYTE cap is deliberately not tiered with these. It exists to
// stop the Atlas cluster filling up, and that reason does not change with what
// somebody paid; a subscriber who wants 10 slots is still bounded by 40MB in
// total. Revisit together, when the vault moves off GridFS.
export const DOCS_PER_ETAG = 1;
export const DOCS_PER_PREMIUM_TAG = 3;
export const DOCS_PER_SUBSCRIBED_TAG = 10;

// The complimentary period that comes with a premium tag.
//
// Every premium tag includes this, at no extra charge, running from the moment
// activation completes. It was 90 days; it is now a full year.
//
// Counted in whole calendar months rather than a day count, for the reason
// addMonths exists at all: a year sold as 365 days ends a day early whenever
// the window crosses a leap February, so "one year" would quietly not be one.
// It also has to be the SAME arithmetic paid periods use, because
// membershipPeriodStart compares this end date against a paid period's to
// decide where a new purchase starts — two notions of "a year" meeting at that
// comparison is how somebody gets sold days they already hold.
//
// It remains a TRIAL, and the honest consequence is worth stating: an owner who
// fills all ten slots during it is over their allowance the day after it ends.
// Nothing is deleted — they keep every document and simply cannot add another
// until they subscribe or delete one — but they must be TOLD the period ends
// while they still have room, which is why the entitlement carries trialEndsAt
// and the page counts it down. A trial that silently becomes a wall is a worse
// product than no trial.
export const PREMIUM_TRIAL_MONTHS = 12;

// How the length is written on screen, DERIVED from the number above rather
// than typed out beside it.
//
// Every previous change to this window left copy behind claiming the old one —
// the dashboard still said 45 days after it became 90, and the membership
// capsule hard-coded the word DAYS in its markup. Deriving the numeral and the
// unit together means the next change is one number here, and no screen can
// contradict what the code actually grants.
//
// `value` and `unit` are separate because the capsule stacks them: a numeral
// over a word. `label` is the same thing as one string for prose.
function trialDisplay(months) {
  if (months % 12 === 0) {
    const years = months / 12;
    const plural = years === 1 ? "" : "s";
    return { value: String(years), unit: `YEAR${plural.toUpperCase()}`, label: `${years} Year${plural}` };
  }
  const plural = months === 1 ? "" : "s";
  return { value: String(months), unit: `MONTH${plural.toUpperCase()}`, label: `${months} Month${plural}` };
}

export const PREMIUM_TRIAL_DISPLAY = trialDisplay(PREMIUM_TRIAL_MONTHS);
export const PREMIUM_TRIAL_LABEL = PREMIUM_TRIAL_DISPLAY.label;

const DAY_MS = 24 * 60 * 60 * 1000;

// How many days the window spans for a period starting at `from`.
//
// Deliberately a function and not a constant, because it is not one: twelve
// calendar months is 365 days or 366 depending on where the year falls. Callers
// that need to place a date either side of the boundary — the tier verification
// script, the tests — ask here rather than re-deriving the arithmetic, so there
// is still exactly one definition of how long the window is.
//
// Anything comparing the two directions should leave a couple of days of slack:
// the twelve months BEFORE a given instant and the twelve months AFTER it can
// differ by one, and a boundary probed at ±1 day would be deciding a test on
// whether a leap February happened to fall inside it.
export function premiumTrialLengthDays(from = Date.now()) {
  return Math.round((addMonths(from, PREMIUM_TRIAL_MONTHS) - from) / DAY_MS);
}

// How far ahead of our own clock a stored start date may sit before it is
// treated as corrupt rather than as drift. Generous next to real NTP skew
// between app instances (seconds), tight next to the year-long window it
// guards.
const TRIAL_START_SKEW_GRACE_MS = 5 * 60 * 1000;

// There is deliberately no single MAX_DOCS_PER_VEHICLE any more. It used to be
// the one number the whole vault was written against, and leaving it behind as
// a synonym for the top tier would invite exactly the bug the tiers exist to
// prevent: code checking "the cap" instead of the cap for THIS tag.
export const TIER_ETAG = "etag";
export const TIER_PREMIUM = "premium";
export const TIER_TRIAL = "premium-trial";
export const TIER_SUBSCRIBED = "premium-subscription";

// Allowlist, not a blocklist. SVG is excluded on purpose despite being an
// image: it can carry script, and these files are served back from our own
// origin, where that would run as us.
const ALLOWED_MIME = new Map([
  ["application/pdf", "pdf"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export const DOC_TYPES = ["rc", "insurance", "puc", "licence", "other"];

// Card previews on the documents page come from a small thumbnail the browser
// renders at upload time, NOT from the document itself. Six full-size photos is
// up to 30MB of image to paint a single list — unusable on mobile data — and
// generating thumbnails server-side would mean pulling in an image library.
// A canvas-scaled JPEG is a few KB, so the whole page costs less than one photo.
//
// It is client-supplied and therefore untrusted: it is capped hard, must be a
// JPEG data URI, and is only ever rendered as an <img>. The real document is
// stored and served separately, so a junk thumbnail costs a wrong picture on a
// card and nothing else.
const MAX_THUMB_CHARS = 40 * 1024;
const THUMB_PREFIX = "data:image/jpeg;base64,";

export function cleanThumbnail(raw) {
  const value = String(raw || "");
  if (!value.startsWith(THUMB_PREFIX)) return null;
  if (value.length > MAX_THUMB_CHARS) return null;
  const body = value.slice(THUMB_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  return value;
}

export function isAllowedMime(mime) {
  return ALLOWED_MIME.has(String(mime || "").toLowerCase());
}

// ── Content sniffing ───────────────────────────────────────────────────────
//
// isAllowedMime() checks the mimetype @fastify/multipart reports, which is
// simply the Content-Type header the CLIENT wrote into the multipart part. It
// is not evidence of anything. A security pass demonstrated both halves of the
// gap: an HTML page carrying a <script> stored as "image/png" and served back
// inline from our own origin, and a Windows PE executable stored as
// "application/pdf" and handed back to the owner as a .pdf attachment.
//
// Neither is currently a live XSS — the file route is served with
// X-Content-Type-Options: nosniff and under the app's CSP, so a browser will
// not render those bytes as HTML. That is one header away from being wrong,
// and it does nothing about the vault being usable as arbitrary file storage on
// our own origin, or about an owner opening a "PDF" that is an executable.
//
// So the declared type must now be corroborated by the bytes. This is an
// allowlist of container signatures, checked against the head of the stream.
const SNIFF_BYTES = 1024;

function looksLikePdf(head) {
  // Not necessarily at offset 0: the PDF spec tolerates leading bytes before
  // the header, and real scanners emit them. Adobe's own rule is "within the
  // first 1024 bytes", which is exactly the window we buffer.
  return head.includes("%PDF-", 0, "latin1");
}

function startsWith(head, bytes) {
  if (head.length < bytes.length) return false;
  return bytes.every((b, i) => head[i] === b);
}

// Returns true when `head` (the first SNIFF_BYTES of the upload, or the whole
// file if it is shorter) is consistent with the declared type.
export function contentMatchesMime(head, mime) {
  const buf = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  if (!buf.length) return false;

  switch (String(mime || "").toLowerCase()) {
    case "application/pdf":
      return looksLikePdf(buf);
    case "image/png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "image/webp":
      // "RIFF" ....(4-byte length).... "WEBP"
      return (
        buf.length >= 12 &&
        buf.toString("latin1", 0, 4) === "RIFF" &&
        buf.toString("latin1", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

// A pass-through that inspects the head of the stream and records the verdict
// on `.matches`, WITHOUT ever erroring.
//
// Deliberately not a stream error: destroying the upload mid-flight leaves the
// multipart parser with an unconsumed request body, which is how an upload
// turns into a hung connection. The route lets the bytes land and then deletes
// them, exactly as it already does for a file that overran the size cap. The
// waste is bounded by that same cap.
export function createMimeSniffer(mime) {
  const chunks = [];
  let length = 0;
  let settled = false;

  const sniffer = new Transform({
    transform(chunk, _encoding, callback) {
      if (!settled) {
        chunks.push(chunk);
        length += chunk.length;
        if (length >= SNIFF_BYTES) settle();
      }
      callback(null, chunk);
    },
    flush(callback) {
      // Reached for a file shorter than the sniff window — including an empty
      // one, which settles to a mismatch and is refused.
      if (!settled) settle();
      callback();
    }
  });

  function settle() {
    settled = true;
    // Trimmed to exactly SNIFF_BYTES. A single chunk can be far larger than the
    // window — a small file arrives whole in one — and without this the search
    // area would be however much happened to be delivered at once, so the same
    // file could pass or fail depending on how it was chunked over the wire.
    const head = Buffer.concat(chunks, length).subarray(0, SNIFF_BYTES);
    sniffer.matches = contentMatchesMime(head, mime);
    chunks.length = 0; // release the buffered head
  }

  sniffer.matches = false;
  return sniffer;
}

export function extensionForMime(mime) {
  return ALLOWED_MIME.get(String(mime || "").toLowerCase()) || "bin";
}

// Images can be shown inline in the sheet; PDFs cannot, because the app's CSP
// has no `frame-src 'self'` and so will not render one in an iframe. Callers
// use this to decide between previewing and downloading rather than serving a
// PDF into a frame that the browser will refuse to paint.
export function isInlineViewable(mime) {
  return String(mime || "").toLowerCase().startsWith("image/");
}

export function isValidDocType(value) {
  return DOC_TYPES.includes(String(value || "").toLowerCase());
}

// Free-text label the owner types ("RC front", "Insurance 2026"). Kept short
// and stripped of control characters; it is rendered escaped on the client, so
// this is about storing something sane rather than about output safety.
export function cleanLabel(raw, fallback) {
  const text = Array.from(String(raw == null ? "" : raw))
    // Drop C0/C1 control characters rather than pattern-matching them, so this
    // file stays free of raw control bytes in its own source.
    .map((ch) => (ch.codePointAt(0) < 0x20 || ch.codePointAt(0) === 0x7f ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return text || fallback;
}

// ── PIN ────────────────────────────────────────────────────────────────────

export function isValidPin(pin) {
  return new RegExp(`^\\d{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`).test(String(pin || ""));
}

// The handful of PINs that a guesser tries first. With a 4-digit minimum the
// lockout is what bounds brute force, and it does its job — but it bounds an
// attacker who has to guess. It does nothing about "0000", which is not really
// a guess. Rejecting repeated digits and runs costs the owner nothing and
// removes the small set of values that a shoulder-surfer or an opportunist
// with the unlocked phone would try inside the ten attempts they are allowed.
//
// Applied only when SETTING a PIN. Verification is untouched, so an owner who
// already has a weak PIN keeps signing in with it and is not locked out by a
// deploy — they are simply held to this the next time they change it.
// A run in ONE direction: 1234 or 4321, not 1213. Every step must match the
// first step, rather than merely being +/-1 — otherwise 4543 and 2321 are
// refused too, and the owner is told to avoid "runs like 1234" about a PIN that
// is not one. Rejecting more than the message explains is its own kind of bug.
function isSequentialPin(digits) {
  const direction = Number(digits[1]) - Number(digits[0]);
  if (direction !== 1 && direction !== -1) return false;
  for (let i = 2; i < digits.length; i += 1) {
    if (Number(digits[i]) - Number(digits[i - 1]) !== direction) return false;
  }
  return true;
}

export function isWeakPin(pin) {
  const digits = String(pin || "");
  if (!isValidPin(digits)) return false; // shape is isValidPin's business
  if (/^(\d)\1*$/.test(digits)) return true; // 0000, 1111, 999999
  if (isSequentialPin(digits)) return true; // 1234, 4321, 3456
  return false;
}

export function pinRequirementMessage() {
  return `PIN must be ${PIN_MIN_DIGITS} to ${PIN_MAX_DIGITS} digits.`;
}

export function weakPinMessage() {
  return "Choose a less predictable PIN — avoid repeated digits like 1111 or runs like 1234.";
}

export async function hasVaultPin(collections, ownerId) {
  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { vaultPinHash: 1 } }
  );
  return Boolean(owner && owner.vaultPinHash);
}

export async function setVaultPin(collections, ownerId, pin) {
  const vaultPinHash = await createPasswordHash(String(pin));
  await collections.owners.updateOne(
    { _id: ownerId },
    { $set: { vaultPinHash, vaultPinSetAt: new Date().toISOString() } }
  );
  // A freshly set PIN clears any standing lockout — the owner has just proven
  // control of the account through whichever path let them change it.
  await clearLoginFailures(collections, LOCKOUT_ROLE, String(ownerId));
}

// Returns { ok } on success, or { ok: false, locked, retryAfterSeconds } so the
// caller can tell "wrong PIN" apart from "stop trying for a while".
export async function verifyVaultPin(collections, ownerId, pin) {
  const key = String(ownerId);

  const lock = await getLoginLock(collections, LOCKOUT_ROLE, key);
  if (lock.locked) {
    return { ok: false, locked: true, retryAfterSeconds: lock.retryAfterSeconds };
  }

  const owner = await collections.owners.findOne(
    { _id: ownerId },
    { projection: { vaultPinHash: 1 } }
  );
  if (!owner || !owner.vaultPinHash) {
    return { ok: false, locked: false, noPin: true };
  }

  // verifyPassword returns { valid, needsUpgrade }, NOT a boolean — destructure
  // it. Testing the object itself is always truthy and would accept any PIN.
  const { valid } = await verifyPassword(String(pin || ""), owner.vaultPinHash);
  if (!valid) {
    await recordLoginFailure(collections, LOCKOUT_ROLE, key);
    return { ok: false, locked: false };
  }

  await clearLoginFailures(collections, LOCKOUT_ROLE, key);
  return { ok: true };
}

// ── Unlock grants ──────────────────────────────────────────────────────────
//
// Keyed by session id, so a grant cannot be lifted from one browser and
// replayed in another: it is only usable by a request that already carries the
// session cookie it was issued to. ownerId is stored alongside and re-checked
// on read, so a recycled session id can never inherit someone else's unlock.

export async function grantVaultAccess(collections, sessionId, ownerId) {
  const expiresAt = new Date(Date.now() + GRANT_TTL_MS);
  await collections.vaultGrants.updateOne(
    { _id: sessionId },
    {
      $set: {
        _id: sessionId,
        ownerId: String(ownerId),
        expiresAt,
        grantedAt: new Date()
      }
    },
    { upsert: true }
  );
  return expiresAt;
}

export async function readVaultGrant(collections, sessionId, ownerId) {
  if (!sessionId) return null;
  const doc = await collections.vaultGrants.findOne({ _id: sessionId });
  if (!doc) return null;
  // The TTL monitor only sweeps about once a minute, so an expired grant can
  // still be sitting in the collection. Check the clock rather than trusting
  // that the sweep has already run.
  if (!doc.expiresAt || doc.expiresAt.getTime() <= Date.now()) return null;
  if (String(doc.ownerId) !== String(ownerId)) return null;
  return doc;
}

export async function revokeVaultAccess(collections, sessionId) {
  if (!sessionId) return;
  await collections.vaultGrants.deleteOne({ _id: sessionId });
}

// ── Document allowance ─────────────────────────────────────────────────────

// Is a paid document subscription running on this tag right now?
//
// The subscription is not sold yet — there is no checkout, no renewal job and
// no webhook that writes this field. What exists is the SHAPE it will be
// written in, read from one place, so that turning it on later is a matter of
// stamping the tag rather than threading a new rule through the upload path,
// the reservation and the page.
//
//   tag.documentSubscription = { status: "active", currentPeriodEnd: <ISO> }
//
// Expiry is checked against the clock rather than trusting a job to have
// downgraded the tag on time: a renewal that fails at 3am must not quietly
// leave the larger allowance open until somebody notices.
// Kept as the name the vault reads, but it no longer owns the rule: the tag has
// ONE subscription and hasActiveSubscription() is the only thing that decides
// whether it is live. It used to look at `tag.documentSubscription` alone,
// which meant a tag renewed for calls kept a lapsed vault — see subscription.js
// for why that was never a choice anybody made.
export function hasActiveDocumentSubscription(tag, now = Date.now()) {
  return hasActiveSubscription(tag, now);
}

// When a premium tag's complimentary period runs out, as epoch ms — or null if
// this tag never had one.
//
// The window opens when the tag reaches a customer, NOT when it is printed.
// Three sources, in the order they answer that question:
//
//   premiumSince   stamped by createPremiumTagForVehicle when somebody buys a
//                  premium tag from the shop. That tag is born already owned,
//                  so the purchase IS the activation.
//   activatedAt    stamped by /claim and /activate the first time a stock tag
//                  is registered to an owner. This is the one that matters for
//                  retail: an admin batch mints premium tags with `premium:
//                  true` and NO premiumSince, so before this existed the whole
//                  window was measured from the print run. A batch printed in
//                  September and sold in December arrived with its free period
//                  already spent, which reads to the customer as a tag that
//                  never worked rather than as a tag that expired on a shelf.
//   createdAt      last resort, for tags activated before activatedAt existed.
//                  Same behaviour those tags already had, so nothing they were
//                  granted is withdrawn by this ordering.
//
// All three are only ever a fallback TOWARDS expiry: an unparseable or missing
// date yields no trial at all rather than an open-ended one, so a malformed tag
// cannot mint free storage.
export function premiumTrialEndsAt(tag, now = Date.now()) {
  if (!tag || !tag.premium) return null;
  const startedAt = new Date(tag.premiumSince || tag.activatedAt || tag.createdAt || "").getTime();
  if (!Number.isFinite(startedAt)) return null;

  // A start date in the future is bad data, and the shape of the bug matters:
  // the window is start + one year, so a date two years out grants three and a
  // clamp to `now` on every read would slide the end forwards forever — an
  // unbounded free tier from a single mistyped field. Beyond the skew grace it
  // is refused outright, which is the same answer this function already gives
  // an unparseable date: no trial rather than an endless one.
  //
  // The grace is there because these dates are written by the app from its own
  // clock and read back by any instance. A few seconds of drift between two
  // instances must not deny a customer the window they just activated, so
  // anything inside the grace counts as "now" instead of being thrown out.
  if (startedAt > now + TRIAL_START_SKEW_GRACE_MS) return null;
  return addMonths(Math.min(startedAt, now), PREMIUM_TRIAL_MONTHS);
}

export function isInPremiumTrial(tag, now = Date.now()) {
  const endsAt = premiumTrialEndsAt(tag, now);
  return endsAt !== null && now < endsAt;
}

// What one tag is allowed to hold. The single place the tiers are decided —
// the upload route, the atomic reservation and the page all read this, so they
// cannot drift into disagreeing about who may store what.
export function documentEntitlement(tag, now = Date.now()) {
  // `premium: true` is the single source of truth for a premium tag. Tags
  // issued before the flag existed have no field at all, so this reads as
  // falsy — which is correct: they are E-Tags.
  if (!tag || !tag.premium) {
    return { tier: TIER_ETAG, maxDocs: DOCS_PER_ETAG, premium: false, subscribed: false };
  }

  // A paying subscriber is never labelled as being on a trial, even inside the
  // first year. Same allowance either way, but the page says something
  // different about each, and telling somebody who has paid that their access
  // expires in three months would be alarming and wrong.
  if (hasActiveDocumentSubscription(tag, now)) {
    return { tier: TIER_SUBSCRIBED, maxDocs: DOCS_PER_SUBSCRIBED_TAG, premium: true, subscribed: true };
  }

  if (isInPremiumTrial(tag, now)) {
    return {
      tier: TIER_TRIAL,
      maxDocs: DOCS_PER_SUBSCRIBED_TAG,
      premium: true,
      subscribed: false,
      trialEndsAt: new Date(premiumTrialEndsAt(tag, now)).toISOString()
    };
  }

  return { tier: TIER_PREMIUM, maxDocs: DOCS_PER_PREMIUM_TAG, premium: true, subscribed: false };
}

// What the owner is told when the vehicle is full. Says which tier they are on
// and what the next one gives them, because "you can keep up to 1 document" on
// its own reads like a fault rather than a plan.
export function documentLimitMessage(entitlement) {
  const { tier, maxDocs } = entitlement;
  const held = `${maxDocs} document${maxDocs === 1 ? "" : "s"}`;

  if (tier === TIER_ETAG) {
    return `Your E-Tag can keep ${held} for this vehicle. Upgrade to a premium tag to keep up to ${DOCS_PER_PREMIUM_TAG}, or delete this one to add another.`;
  }
  return `This vehicle can keep ${held}. Delete one to add another.`;
}

// ── Quota ──────────────────────────────────────────────────────────────────

// Checked BEFORE a file is streamed into GridFS, using the declared size, and
// again after the write against the real byte count — a multipart client can
// declare anything, so the pre-check is only there to reject the obvious case
// cheaply.
export async function checkQuota(collections, ownerId, tagId, entitlement) {
  const allowance = entitlement || { tier: TIER_ETAG, maxDocs: DOCS_PER_ETAG };
  const [vehicleCount, totals] = await Promise.all([
    collections.vaultDocuments.countDocuments({ ownerId, tagId }),
    collections.vaultDocuments
      .aggregate([
        { $match: { ownerId } },
        { $group: { _id: null, bytes: { $sum: "$size" } } }
      ])
      .toArray()
  ]);

  const usedBytes = (totals[0] && totals[0].bytes) || 0;

  if (vehicleCount >= allowance.maxDocs) {
    return {
      ok: false,
      limit: "documents",
      tier: allowance.tier,
      error: documentLimitMessage(allowance)
    };
  }
  if (usedBytes >= MAX_BYTES_PER_OWNER) {
    return {
      ok: false,
      error: "You've used all your document storage. Delete a document to free up space."
    };
  }
  return { ok: true, usedBytes, vehicleCount };
}

// ── Storage reservation ────────────────────────────────────────────────────
//
// checkQuota() above reads counts and totals, and the route then writes. That
// is a check-then-write with nothing in between, and under a burst it simply
// does not hold: a security pass sent 12 concurrent uploads at a 6-per-vehicle
// cap and stored 12, and 15 concurrent 4MB uploads at a 40MB per-owner cap and
// stored 60MB. Every request read the same pre-write state, and every request
// was genuinely under the limit at the moment it looked. The rate limiter does
// not save it either — 20 uploads per 5 minutes is 100MB against a 40MB cap
// even served strictly one at a time.
//
// Re-counting after the insert does not fix this. Whichever way it is phrased,
// a count can miss a concurrent insert that has not landed yet, so it can still
// admit more than the cap allows.
//
// What does hold is a single-document conditional update. MongoDB applies one
// update to one document atomically, so making the LIMIT part of the update's
// filter means the increment happens if and only if there is room, with no gap
// for a second request to slip through. `vault_usage` holds one row per owner —
// total bytes, plus a document count per vehicle — and every upload has to win
// that update before its record is written.
//
// Bookkeeping is `$inc` in both directions and never a recomputation, because
// increments commute: two concurrent uploads and a concurrent delete land in
// any order and still arrive at the same total. A recompute racing an insert
// would lose it.
function usageKey(ownerId) {
  return String(ownerId);
}

// A vehicle's count lives at `tags.<tagId>`. tagId is the 24-character hex of
// an ObjectId, so it is always a legal field name — no dots, never a leading $.
function tagCountField(tagId) {
  return `tags.${String(tagId)}`;
}

// Owners who already had documents before this collection existed have no row.
// Seed it from what they actually hold rather than from zero, or their first
// upload after the deploy would start counting from an empty vault. Racing
// callers are harmless: $setOnInsert means only the first insert applies, and
// both compute the same pre-existing truth.
//
// This is also the RECOVERY path, and the reason there is no reconciliation on
// the request path. Documents removed out of band — a manual cleanup, a
// migration, anything that does not go through releaseStorage — leave the
// counter reading high, and the owner quietly loses storage they are entitled
// to. The repair is to delete that owner's `vault_usage` row: the next upload
// finds it missing and rebuilds it from the documents that actually exist.
// Recomputing automatically when a reservation is refused would be the obvious
// alternative and is a worse one — refusal is exactly the state an attacker can
// drive on demand, and it would hand them a recount to race.
async function ensureUsageRow(collections, ownerId) {
  const key = usageKey(ownerId);
  const existing = await collections.vaultUsage.findOne(
    { _id: key },
    { projection: { _id: 1 } }
  );
  if (existing) return;

  const docs = await collections.vaultDocuments
    .find({ ownerId }, { projection: { tagId: 1, size: 1 } })
    .toArray();

  const tags = {};
  let bytes = 0;
  for (const doc of docs) {
    bytes += doc.size || 0;
    const tagId = String(doc.tagId);
    tags[tagId] = (tags[tagId] || 0) + 1;
  }

  await collections.vaultUsage.updateOne(
    { _id: key },
    { $setOnInsert: { bytes, tags } },
    { upsert: true }
  );
}

// Claim room for one document of `size` bytes against `tagId`. Returns
// { ok: true } only if the reservation was actually taken.
// `entitlement` is what documentEntitlement() returned for the tag being filed
// under. It is passed in rather than looked up here so the tier that was read
// when the tag was authorised is the same one that binds the write — re-reading
// the tag mid-upload would open a gap where a subscription expiring between the
// two checks refuses an upload the owner was told they could make.
export async function reserveStorage(collections, ownerId, tagId, size, entitlement) {
  const allowance = entitlement || { tier: TIER_ETAG, maxDocs: DOCS_PER_ETAG };
  await ensureUsageRow(collections, ownerId);

  const field = tagCountField(tagId);
  const result = await collections.vaultUsage.updateOne(
    {
      _id: usageKey(ownerId),
      // A file larger than the whole allowance makes this bound negative, which
      // no non-negative total can satisfy — so it is refused, as it should be.
      bytes: { $lte: MAX_BYTES_PER_OWNER - size },
      // $not also matches a MISSING field, which is what the first document for
      // a vehicle looks like. A bare $lt would not match it and would reject
      // every owner's very first upload.
      //
      // The bound is the TAG's allowance, not a global constant, which is what
      // makes the tiers hold under concurrency as well: an E-Tag firing ten
      // uploads at once still lands exactly one, for the same reason a premium
      // tag lands exactly three.
      [field]: { $not: { $gte: allowance.maxDocs } }
    },
    { $inc: { bytes: size, [field]: 1 } }
  );

  if (result.matchedCount === 1) return { ok: true };

  // Refused. Read the row back only to say WHICH limit was hit — the decision
  // itself was already made, atomically, above.
  const row = await collections.vaultUsage.findOne({ _id: usageKey(ownerId) });
  const vehicleCount = (row && row.tags && row.tags[String(tagId)]) || 0;

  if (vehicleCount >= allowance.maxDocs) {
    return {
      ok: false,
      limit: "documents",
      tier: allowance.tier,
      error: documentLimitMessage(allowance)
    };
  }
  return {
    ok: false,
    error: "You've used all your document storage. Delete a document to free up space."
  };
}

// Hand storage back. Used when an upload is rolled back after reserving, and
// whenever documents are deleted — one at a time, or in a cascade.
export async function releaseStorage(collections, ownerId, entries) {
  const released = Array.isArray(entries) ? entries : [entries];
  if (!released.length) return;

  const inc = { bytes: 0 };
  for (const entry of released) {
    if (!entry) continue;
    inc.bytes -= entry.size || 0;
    // A record with no tagId should still give its bytes back rather than
    // decrementing a `tags.undefined` field into existence.
    if (entry.tagId === null || entry.tagId === undefined) continue;
    const field = tagCountField(entry.tagId);
    inc[field] = (inc[field] || 0) - 1;
  }

  if (!inc.bytes && Object.keys(inc).length === 1) return;

  await collections.vaultUsage
    .updateOne({ _id: usageKey(ownerId) }, { $inc: inc })
    .catch(() => {
      // Bookkeeping must never turn a successful delete into an error. A lost
      // decrement leaves the owner's counter reading HIGH, which costs them
      // storage they are entitled to but can never let them exceed the cap.
    });
}

// The whole owner is going away — drop their counter with them.
export async function deleteUsage(collections, ownerId) {
  await collections.vaultUsage.deleteOne({ _id: usageKey(ownerId) }).catch(() => {});
}

// Move a vehicle's documents onto a different tag.
//
// NOT every tag that goes away is a vehicle going away, and telling the two
// apart is the whole point of this function. When an owner buys a premium tag
// to replace a free-trial one (M18), the OLD tag is soft-deleted and a NEW tag
// is minted for the SAME car. Purging there would be exactly wrong: the owner
// still has the vehicle, still has the paperwork, and has just paid for the
// upgrade.
//
// Before this existed the documents stayed pinned to the dead tag, which
// ownedTag() refuses — so an owner's RC became unreachable at the moment they
// bought something. Silent data loss, triggered by a purchase.
//
// The owner's byte total does not change: the same owner holds the same
// documents. Only the per-vehicle counts move.
export async function reassignVaultDocuments(collections, ownerId, fromTagId, toTagId) {
  const from = String(fromTagId || "");
  const to = String(toTagId || "");
  if (!from || !to || from === to) return { moved: 0 };

  const result = await collections.vaultDocuments.updateMany(
    { ownerId, tagId: from },
    { $set: { tagId: to } }
  );

  const moved = result.modifiedCount || 0;
  if (!moved) return { moved: 0 };

  await collections.vaultUsage
    .updateOne(
      { _id: usageKey(ownerId) },
      { $inc: { [tagCountField(from)]: -moved, [tagCountField(to)]: moved } }
    )
    .catch(() => {
      // The documents have moved and are reachable, which is the part that
      // matters. A stale count reads high against the OLD tag, which no longer
      // exists — so it can only ever cost an upload slot on a vehicle the owner
      // can no longer reach anyway.
    });

  return { moved };
}

// Opaque per-document id used in URLs. The GridFS _id is never exposed: it is
// the storage key, and keeping it server-side means a leaked URL cannot be
// turned into a direct bucket reference.
export function newDocumentId() {
  return crypto.randomBytes(16).toString("hex");
}

// ── Cascading deletion ─────────────────────────────────────────────────────
//
// A vault document is created by the upload route and used to be removed ONLY
// by the per-document delete route. Nothing else in the app knew these records
// existed, so the two deletions that should have taken them with them did not:
//
//   • Deleting a VEHICLE soft-deletes its tag. ownedTag() then refuses the tag,
//     so the owner could no longer list or delete the documents filed under it
//     — but the rows and the GridFS bytes stayed, unreachable and permanent,
//     still counted against the owner's storage quota.
//   • Deleting an ACCOUNT wiped tags, contact requests, orders, addresses and
//     pending calls, and left the vault untouched. An RC, a driving licence and
//     an insurance policy therefore SURVIVED the account they belonged to, with
//     no sweeper anywhere to collect them. For an erasure request under the
//     DPDP Act that is precisely the data that must not be retained.
//
// Both paths now come through here. Metadata is removed FIRST, for the same
// reason the single-document route does it in that order: if the bucket delete
// then fails, what is left behind is an orphaned blob to sweep rather than a
// listed document whose bytes have already vanished.
//
// `bucket` may be null when document storage is unreachable. The metadata is
// still removed in that case — the alternative is refusing to delete an account
// because a blob store is down — and the blobs are reported as orphaned so the
// caller can log it.
export async function purgeVaultDocuments(collections, bucket, filter) {
  const docs = await collections.vaultDocuments
    .find(filter, { projection: { _id: 1, fileId: 1, ownerId: 1, tagId: 1, size: 1 } })
    .toArray();

  if (!docs.length) return { documents: 0, blobs: 0, orphanedBlobs: 0 };

  await collections.vaultDocuments.deleteMany({ _id: { $in: docs.map((d) => d._id) } });

  // Return the reserved storage. Grouped by owner because a cascade may span
  // several vehicles, and (in principle) the filter is not required to be
  // owner-scoped.
  const byOwner = new Map();
  for (const doc of docs) {
    const key = String(doc.ownerId);
    if (!byOwner.has(key)) byOwner.set(key, []);
    byOwner.get(key).push({ tagId: doc.tagId, size: doc.size });
  }
  for (const [ownerId, entries] of byOwner) {
    await releaseStorage(collections, ownerId, entries);
  }

  let blobs = 0;
  let orphanedBlobs = 0;

  for (const doc of docs) {
    if (!doc.fileId) continue;
    if (!bucket) {
      orphanedBlobs += 1;
      continue;
    }
    try {
      await bucket.delete(doc.fileId);
      blobs += 1;
    } catch {
      // Already gone, or the bucket refused it. Either way the metadata row is
      // deleted, so this is a blob to sweep rather than a failed deletion.
      orphanedBlobs += 1;
    }
  }

  return { documents: docs.length, blobs, orphanedBlobs };
}
