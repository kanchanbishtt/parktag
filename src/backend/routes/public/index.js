import { ObjectId } from "mongodb";

import { createContactAction, isSupportedContactReason } from "../../lib/core/contact-actions.js";
import { createPasswordHash, createSecureToken, safeEqual, hashIp, minutesFromNow, getClientIp, maskPlateNumber, getPlateLastFour, isNonEmptyString } from "../../lib/auth/security.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import {
  findOwnerHoldingMobile,
  isDuplicateMobileError,
  isMobileIdentifier,
  normalizeIdentifier,
  verifyOtp,
  resolveOwnerByVerifiedMobile
} from "../../lib/auth/otp.js";
import { getCollections, ensureVerificationIndexes, ensurePendingCallsIndexes } from "../../lib/db/repositories.js";
import {
  VEHICLE_LABELS,
  etagIdFor,
  stickerSerialFor,
  isSupportedVehicleType,
  suggestedVehicleTypeForMount,
  vehicleCategoryForMount,
  vehicleTypeMatchesMount,
  mountMismatchMessage
} from "../../lib/core/tag-issuance.js";
import { verifyRecaptchaV2 } from "../../lib/integrations/recaptcha.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { findByCanonicalEmail } from "../../lib/auth/identity.js";
import { recordDemoActivation } from "../../lib/core/marketing-stock.js";

// Report reasons, matched exactly. An open text field for the reason would let
// a reporter write anything into a record support reads later.
const REPORT_REASONS = ["sold", "wrong_number", "no_answer", "abuse", "other"];

// Verification security parameters (spec: 3 attempts, then temporary lockout).
const MAX_VERIFY_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;
const GRANT_TTL_MINUTES = 15;
const SESSION_TTL_MINUTES = 30;

// ── Per-TAG brute-force ceiling (IP-independent) ──────────────────────────
// The per-IP lockout above is the primary control, but it is only as sound as
// `trustProxy` in app.js being set to the real number of proxy hops: too high
// and `request.ip` becomes client-settable again, too low and every visitor
// shares one bucket. Because this single check is what stands between a
// stranger and a masked call, the owner's SOS contact, and the plate, it must
// not rest on one integer staying correct through future infra changes (a CDN
// added in front of Railway would change that hop count).
//
// So we ALSO cap failures per tag across every IP. No header, proxy topology,
// or address rotation can widen this bucket — the tag token is the key, and the
// attacker is by definition brute-forcing one specific tag.
//
// Sizing is deliberately generous: a legitimate finder is standing at the
// vehicle reading the plate off it, so genuine failures are near zero. 30
// failures/hour still reduces an exhaustive search of the 10,000-combination
// space to ~14 days per tag, while making an accidental lockout of a real
// scanner effectively impossible. The 15-minute lockout is kept short on
// purpose: a longer one would be a cheap way for an abuser to keep a vehicle's
// emergency contact unreachable.
const MAX_TAG_ATTEMPTS_PER_WINDOW = 30;
const TAG_WINDOW_MINUTES = 60;
const TAG_LOCKOUT_MINUTES = 15;

// ── SOS abuse ceiling ─────────────────────────────────────────────────────
// The emergency contact is a THIRD party's number (next of kin) that the owner
// types in without proving that person consented, and the SOS call is
// deliberately exempt from the one-free-contact rule. Together that is an
// amplification path: an owner could point SOS at someone else's number and
// then ring it by scanning their own tag.
//
// The number stays un-OTP'd on purpose — demanding a code from the next of kin
// would make the feature unusable in the case it exists for. Bound the abuse
// instead: a hard per-tag daily ceiling, plus an ownerId on every SOS record so
// a pattern is attributable and bannable.
//
// 5/day is well above real use (an incident draws one or two callers) and caps
// what a determined abuser can inflict, without risking a refusal to connect
// next of kin during an actual emergency.
const MAX_EMERGENCY_CALLS_PER_DAY = 5;

// Retire this caller's live pending call FOR THIS VEHICLE before registering a
// new one, so one sticker never has two routes waiting at once.
//
// The Dial Whom webhook matches on callerPhone alone. A scanner who tried
// Private Call, got no answer and then tapped Emergency therefore left two
// unconsumed rows behind, and the webhook could pick the older one — dialling
// the owner's unanswered phone instead of the next of kin. The webhook now
// sorts newest-first as well; this keeps the stale row from surviving to be
// matched by a later redial, which the sort alone would not prevent.
//
// Scoped by token on purpose. Retiring every row for the caller also threw away
// registrations for OTHER vehicles: scan car A, scan car B, then dial, and A's
// route was silently gone with no way back but re-scanning A. Exotel only tells
// us the caller's number, never which sticker they scanned, so the webhook
// cannot disambiguate — but leaving each vehicle's row intact means a second
// dial still reaches the earlier one instead of nothing.
//
// `consumed: true` is what the webhook filters on, so that is what retires a
// row; supersededAt records why, to keep it distinguishable from a real answer.
async function supersedePendingCalls(collections, callerPhone, token, now) {
  await collections.pendingCalls.updateMany(
    { callerPhone, token, consumed: false },
    { $set: { consumed: true, supersededAt: now.toISOString() } }
  );
}

// Refuse to re-point a caller's number while another client is holding it.
//
// The number a masked call rings back on is taken on trust: a finder standing
// at a vehicle has no way to prove a number, and demanding a code before they
// can report a blocked driveway would break the feature in the situation it
// exists for. Exotel then tells the Dial Whom webhook nothing about an incoming
// call except the number it came from, so that number is the whole of the
// routing key — and whoever registered it last decides where the call lands.
//
// That is enough for a stranger who knows someone's mobile number: register it
// against a tag of their own, wait for that person to dial the virtual number,
// and take a call the caller believes is going to a vehicle's owner.
//
// The registrant cannot be identified, but it can be distinguished. A genuine
// second registration for a number comes from the handset that made the first
// one — scan car A then car B, or try the owner and then Emergency — while a
// planted one does not. So a live route registered from a different client
// makes this registration a contest, and the contest is settled in favour of
// whoever got there first: the handset already holding the number keeps its
// route, and the stranger gets a refusal instead of the newest-wins victory
// they were counting on.
//
// Deliberately NOT the other way round. By the time a contest arrives the
// incumbent has already spent the tag's one free contact, so retiring their
// route would leave them unable to register another one (402 FREE_USED) — and
// anyone could then permanently silence an E-Tag by registering its finder's
// number a second time. Refusing the newcomer costs a genuine newcomer nothing
// but a retry, because this runs before anything is written.
//
// Residual, stated plainly: a number planted BEFORE its real holder registers
// anything is the only live route for that number, so someone who dials the
// virtual number from their call history rather than through the page can still
// be misrouted until the row expires. Closing that needs a caller number the
// server can actually prove — an OTP on the finder, or a per-registration
// virtual number from Exotel — neither of which is a change this endpoint can
// make on its own.
//
// Rows written before this check existed carry no registrantIpHash, so they
// read as another client and can cost one retry. They expire within ten minutes.
async function claimCallerNumber(collections, { callerPhone, registrantIpHash, now, log }) {
  const live = await collections.pendingCalls
    .find({ callerPhone, consumed: false, expiresAt: { $gt: now } })
    .toArray();

  const foreign = live.filter((row) => row.registrantIpHash !== registrantIpHash);

  if (!foreign.length) {
    return true;
  }

  log?.warn?.(
    {
      event: "pending-call-contested",
      held: foreign.length,
      tags: [...new Set(foreign.map((row) => row.token))].length
    },
    "[calls] refusing to re-point a caller number another client is holding"
  );

  return false;
}

// A grant authorises a scanner, not a plate-reading.
//
// /verify issues the grant before any phone number is known, so it cannot be
// bound at issue time. Previously that left one verification able to register
// masked calls for unlimited, arbitrary numbers — and the caller's number is
// the one Exotel rings, so that is a route to making a stranger's phone ring on
// demand.
//
// Bound rather than pinned to the first number: there is no validation on the
// caller's number (a typo registers happily), so pinning would lock a scanner
// out of their own correction and force a re-verify mid-incident. Three
// distinct numbers absorbs a fumbled digit while still ending "any number".
// The same number re-registering is always fine — escalating Private Call ->
// Emergency must never need a re-verify.
//
// One atomic findOneAndUpdate rather than read-then-write: two registrations
// racing with different numbers would both pass a plain read, and only the
// conditional filter can make exactly one of them win.
const MAX_PHONES_PER_GRANT = 3;

async function claimGrantForPhone(collections, grantSession, callerPhone) {
  const claimed = await collections.verificationSessions.findOneAndUpdate(
    {
      _id: grantSession._id,
      $or: [
        // Already this number — always allowed.
        { grantPhones: callerPhone },
        // Never used yet.
        { grantPhones: { $exists: false } },
        { grantPhones: { $size: 0 } },
        // Still under the ceiling: index MAX-1 absent means fewer than MAX.
        { [`grantPhones.${MAX_PHONES_PER_GRANT - 1}`]: { $exists: false } }
      ]
    },
    {
      $addToSet: { grantPhones: callerPhone },
      $set: { grantPhoneAt: new Date().toISOString() }
    },
    { returnDocument: "after" }
  );
  return Boolean(claimed);
}
// Sentinel `ipHash` marking the per-tag bucket. Real values are 64-char SHA-256
// hex, so "*" can never collide with a per-IP row, and reusing this collection
// means the existing TTL cleanup already covers it.
const TAG_BUCKET_KEY = "*";

// Identity for the two attempt buckets.
//
// Both are deterministic so that the upsert in reserveAttempt lands on exactly
// one document per bucket. Mongo enforces uniqueness on `_id` and nowhere else:
// on a plain { token, ipHash } lookup, two concurrent upserts each insert their
// own row, and a second row is a second full allowance. `ipHash` is already
// sha256(ip|token) (see hashIp), so it identifies one scanner on one tag
// without the token needing to be appended to it.
//
// The prefixes keep the two kinds apart, and keep both distinguishable from the
// ObjectId-keyed rows written before this scheme — those are simply not read
// any more, and the TTL removes them.
function ipBucketId(ipHash) {
  return `ip:${ipHash}`;
}

function tagBucketId(token) {
  return `tag:${token}`;
}

// Take one attempt from a bucket and report the running total, atomically.
// Returns the count INCLUDING this attempt. See the call site for why the
// reservation has to happen before the submitted digits are compared.
async function reserveAttempt(collections, { id, token, ipHash, now, ttlMinutes, onInsert }) {
  const doc = await collections.verificationSessions.findOneAndUpdate(
    { _id: id },
    {
      $inc: { attempts: 1 },
      $set: { updatedAt: now.toISOString(), expiresAt: minutesFromNow(ttlMinutes) },
      // Kept disjoint from $set above on purpose: naming one field in both is a
      // Mongo write error, not a precedence rule.
      $setOnInsert: {
        token,
        ipHash,
        lockedUntil: null,
        verified: false,
        grantId: null,
        grantExpiresAt: null,
        createdAt: now.toISOString(),
        ...onInsert
      }
    },
    { upsert: true, returnDocument: "after" }
  );

  return doc?.attempts || 0;
}

// Close a bucket for `minutes`.
//
// The count is deliberately NOT zeroed here. Zeroing on the way in looks tidy
// and is wrong: requests that were already past the lock check when the bucket
// closed go on to reserve, and the reset hands them a fresh allowance — a
// parallel burst of eight got four comparisons out of a three-guess bucket that
// way. The count is cleared when the lock lapses instead (see clearLapsedLock),
// which is the only moment a new allowance is actually due.
async function lockBucket(collections, id, minutes, now) {
  await collections.verificationSessions.updateOne(
    { _id: id },
    {
      $set: {
        lockedUntil: minutesFromNow(minutes).toISOString(),
        updatedAt: now.toISOString()
      }
    }
  );
}

// Reopen a bucket whose lockout has run out, and give it its allowance back.
//
// Without this the count would still be at the ceiling when the lock lapsed, so
// the next attempt would overshoot and re-lock immediately, and the bucket would
// never open again. The exact lockedUntil value is part of the filter, so of
// several requests arriving together at the moment of expiry, exactly one
// resets the count and the others match nothing and move on.
async function clearLapsedLock(collections, id, doc, now) {
  if (!doc?.lockedUntil || new Date(doc.lockedUntil) > now) {
    return;
  }

  await collections.verificationSessions.updateOne(
    { _id: id, lockedUntil: doc.lockedUntil },
    { $set: { attempts: 0, lockedUntil: null, updatedAt: now.toISOString() } }
  );
}

export function registerPublicRoutes(app, env) {
  app.get("/api/tags/:token", async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const tag = await collections.tags.findOne({ token: request.params.token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    // NOTE: plateLastFour is intentionally NOT returned — the last-4 answer must
    // never reach the client. Verification is done server-side via /verify below.
    return {
      ok: true,
      tag: {
        token: tag.token,
        status: tag.status,
        // The identifier a person can read back to support. A premium tag has a
        // serial physically printed on the sticker they are standing in front
        // of, so that one wins; an E-Tag has no printed serial and falls back to
        // the canonical PT-XXXXXXXX form the owner dashboard and admin already
        // show. Both are derived from records that already exist — neither is
        // secret, and the scanner is holding the 64-char token either way.
        tagId: stickerSerialFor(tag) || etagIdFor(tag._id),
        vehicleType: tag.vehicleType || null,
        // Show the real vehicle type per vehicle (e.g. "Auto Rickshaw"), falling back
        // to the stored label only for older tags without a type.
        vehicleLabel: VEHICLE_LABELS[tag.vehicleType] || tag.vehicleLabel || "Vehicle",
        maskedPlateNumber:
          tag.status === "active" ? maskPlateNumber(tag.plateNumber) : null,
        callPreviewNumber:
          tag.status === "active" ? env.exotelCallerId || null : null,
        // Whether an emergency contact exists — a boolean ONLY. The number
        // itself must never reach the scanner; the SOS call is masked through
        // Exotel exactly like the owner call, so the client only ever learns
        // that the button is worth showing.
        emergencyAvailable:
          tag.status === "active" && isNonEmptyString(tag.emergencyContact),
        claimable: ["unclaimed", "inactive"].includes(tag.status),
        // Which vehicle type the activation wizard opens on, derived from the
        // sticker's mount type (see suggestedVehicleTypeForMount). Sent only
        // for a tag that can still be claimed — it is an input hint for the
        // wizard, and has no meaning for a scanner looking at someone else's
        // active tag. Null on tags issued before mount types existed, and the
        // wizard then opens with nothing chosen rather than guessing.
        suggestedVehicleType: ["unclaimed", "inactive"].includes(tag.status)
          ? suggestedVehicleTypeForMount(tag.mountType)
          : null,
        vehicleCategory: ["unclaimed", "inactive"].includes(tag.status)
          ? vehicleCategoryForMount(tag.mountType)
          : null
      },
      // Public support handle for the activation wizard's help card. Null when
      // unconfigured, in which case the card is not rendered at all.
      supportWhatsapp: env.supportWhatsappNumber || null
    };
  });

  // Server-side vehicle verification. The scanner submits the last 4 digits of
  // the plate; we compare server-side, track failed attempts per (token + IP),
  // lock out after 3 failures for 15 minutes, and on success issue a short-lived
  // grant that the contact endpoints require. This cannot be bypassed from the UI.
  app.post("/api/tags/:token/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    await ensureVerificationIndexes(collections);

    const { token } = request.params;
    const lastFour = String((request.body || {}).lastFour || "").trim();

    const tag = await collections.tags.findOne({ token });

    if (!tag || tag.status !== "active") {
      reply.code(404);
      return { ok: false, error: "Tag not found or not active" };
    }

    const ipHash = hashIp(getClientIp(request), token);
    const now = new Date();

    // Read both buckets by their deterministic ids (see ipBucketId). Rows left
    // by the previous, ObjectId-keyed scheme are not seen here — they carry no
    // lock worth the few minutes the TTL takes to remove them, and the grant
    // lookups further down this file match on { token, grantId } rather than on
    // identity, so a verification in flight across a deploy still resolves.
    const ipDocId = ipBucketId(ipHash);
    const tagDocId = tagBucketId(token);

    const [session, tagBucket] = await Promise.all([
      collections.verificationSessions.findOne({ _id: ipDocId }),
      collections.verificationSessions.findOne({ _id: tagDocId })
    ]);

    // A lock that has run out is cleared here, before anything is counted, so
    // that a bucket which has served its lockout starts from a clean allowance.
    await Promise.all([
      clearLapsedLock(collections, ipDocId, session, now),
      clearLapsedLock(collections, tagDocId, tagBucket, now)
    ]);

    const lockedUntil =
      [session?.lockedUntil, tagBucket?.lockedUntil]
        .filter(Boolean)
        .map((value) => new Date(value))
        .filter((date) => date > now)
        .sort((a, b) => b - a)[0] || null;

    // Honour an active lockout — whichever of the two buckets (this IP, or this
    // tag across all IPs) is still locked, and for the longer of the two.
    if (lockedUntil) {
      const remainingMin = Math.ceil((lockedUntil.getTime() - now.getTime()) / 60000);
      reply.code(423);
      return {
        ok: false,
        locked: true,
        error: `Too many incorrect attempts. Try again in ${remainingMin} minute(s).`
      };
    }

    if (!lastFour || !/^\d{4}$/.test(lastFour)) {
      reply.code(400);
      return { ok: false, error: "Enter the last 4 digits of the vehicle number." };
    }

    // ── Reserve an attempt, and only then compare ───────────────────────
    //
    // The lock check above is a snapshot of state that parallel requests are
    // still moving, so it cannot be the thing that rations guesses. Both
    // counters used to be read here, incremented in JS and written back with
    // $set, which meant simultaneous requests all read the same value and all
    // wrote back that same value + 1: eight concurrent wrong answers advanced
    // the per-tag counter by three. That counter is the control that is meant
    // to hold when an attacker rotates source addresses, so losing counts to a
    // race defeats the ceiling it enforces.
    //
    // $inc is applied by the server, so N concurrent reservations produce N
    // distinct totals and none are lost. Reserving BEFORE the comparison is
    // what makes the ceiling real: a request that overshoots is refused without
    // its digits ever being checked, so a burst cannot buy more comparisons
    // than the ceiling allows. A wrong answer costs a slot either way, so
    // nothing about a genuine scanner's three tries changes.
    //
    // The window rolls first, with the staleness test inside the FILTER so
    // Mongo evaluates it atomically: the first request through resets the
    // count, and a concurrent second one no longer matches and goes on to
    // increment the fresh one. lockedUntil is deliberately left alone — a lock
    // set late in a window outlives that window, and clearing it here would cut
    // the lockout short.
    await collections.verificationSessions.updateOne(
      {
        _id: tagDocId,
        windowStart: {
          $lt: new Date(now.getTime() - TAG_WINDOW_MINUTES * 60 * 1000).toISOString()
        }
      },
      { $set: { attempts: 0, windowStart: now.toISOString() } }
    );

    const ipAttempts = await reserveAttempt(collections, {
      id: ipDocId,
      token,
      ipHash,
      now,
      ttlMinutes: SESSION_TTL_MINUTES
    });

    const tagAttempts = await reserveAttempt(collections, {
      id: tagDocId,
      token,
      ipHash: TAG_BUCKET_KEY,
      now,
      ttlMinutes: TAG_WINDOW_MINUTES + TAG_LOCKOUT_MINUTES,
      onInsert: { windowStart: now.toISOString() }
    });

    // AT the ceiling: this attempt is the last one of the allowance and is still
    // compared. Three attempts has always meant three real chances, and the
    // third one may be the right answer.
    const ipAtCeiling = ipAttempts >= MAX_VERIFY_ATTEMPTS;
    const tagAtCeiling = tagAttempts >= MAX_TAG_ATTEMPTS_PER_WINDOW;

    // PAST it: only reachable when requests raced each other into the same
    // allowance. It is already spent, so lock and refuse without comparing.
    if (ipAttempts > MAX_VERIFY_ATTEMPTS || tagAttempts > MAX_TAG_ATTEMPTS_PER_WINDOW) {
      const tagOverflow = tagAttempts > MAX_TAG_ATTEMPTS_PER_WINDOW;

      if (ipAttempts > MAX_VERIFY_ATTEMPTS) {
        await lockBucket(collections, ipDocId, LOCKOUT_MINUTES, now);
      }
      if (tagOverflow) {
        await lockBucket(collections, tagDocId, TAG_LOCKOUT_MINUTES, now);
      }

      reply.code(423);
      return {
        ok: false,
        locked: true,
        error: `Too many incorrect attempts. Try again in ${
          tagOverflow ? TAG_LOCKOUT_MINUTES : LOCKOUT_MINUTES
        } minutes.`
      };
    }

    const expected = getPlateLastFour(tag.plateNumber) || "";
    const isMatch = expected.length === 4 && safeEqual(lastFour, expected);

    if (!isMatch) {
      if (ipAtCeiling) {
        await lockBucket(collections, ipDocId, LOCKOUT_MINUTES, now);
      }

      // Per-tag ceiling, counted across every IP (see MAX_TAG_ATTEMPTS_PER_WINDOW).
      if (tagAtCeiling) {
        await lockBucket(collections, tagDocId, TAG_LOCKOUT_MINUTES, now);
        request.log.warn(
          { event: "tag-verify-bruteforce", token },
          "[verify] per-tag attempt ceiling hit — tag locked across all IPs"
        );
      }

      if (ipAtCeiling || tagAtCeiling) {
        reply.code(423);
        return {
          ok: false,
          locked: true,
          error: `Too many incorrect attempts. Try again in ${
            tagAtCeiling ? TAG_LOCKOUT_MINUTES : LOCKOUT_MINUTES
          } minutes.`
        };
      }

      reply.code(401);
      return {
        ok: false,
        error: "Those last 4 digits do not match this vehicle.",
        attemptsRemaining: MAX_VERIFY_ATTEMPTS - ipAttempts
      };
    }

    // Success — issue a fresh grant.
    const grantId = createSecureToken();
    await collections.verificationSessions.updateOne(
      { _id: ipDocId },
      {
        $set: {
          attempts: 0,
          lockedUntil: null,
          verified: true,
          grantId,
          grantExpiresAt: minutesFromNow(GRANT_TTL_MINUTES).toISOString(),
          // A fresh grant starts with a clean set of caller numbers. The session
          // document is one per (scanner, tag) and is reused across verifies,
          // so without this the numbers claimed under claimGrantForPhone would
          // accumulate for the life of the session and a scanner who re-verified
          // would find their new grant already exhausted.
          grantPhones: [],
          updatedAt: now.toISOString(),
          expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
        }
      }
    );

    // A correct answer proves a real scanner is at the vehicle, so clear the
    // per-tag failure count — otherwise unrelated earlier fumbles could still
    // tip a legitimately-used tag into a lockout later in the window. That also
    // returns the slot this attempt reserved, which a correct answer should
    // never have cost the next scanner.
    await collections.verificationSessions.updateOne(
      { _id: tagDocId },
      { $set: { attempts: 0, windowStart: now.toISOString(), lockedUntil: null } }
    );

    return {
      ok: true,
      grant: grantId,
      vehicleLabel: tag.vehicleLabel || "Registered vehicle",
      maskedPlateNumber: maskPlateNumber(tag.plateNumber),
      // Free-usage state for the UI (authoritative check is still server-side
      // on the contact endpoint). Premium tags always have contact available.
      contactAvailable: Boolean(tag.premium) || !tag.freeContactUsed,
      // Whether contact is unlimited — i.e. whether ONE action is all this
      // scanner gets. `contactAvailable` only answers "may you act right now",
      // which is true for both products before the first action, so the client
      // could not tell them apart afterwards and locked the paid tag like a
      // free one. The client uses this for nothing but re-enabling the call
      // button; every actual permission check stays server-side below.
      unlimitedContact: Boolean(tag.premium)
    };
  });

  // Unauthenticated and creates a new owner account (bcrypt hash + insert) on
  // every call, same abuse shape as /api/register-owner — rate-limit it the
  // same way so it can't be used to flood the DB with accounts or to burn
  // CPU on repeated bcrypt hashing.
  app.post("/api/tags/:token/claim", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const { email, password, displayName, phone, vehicleLabel, plateNumber, otp } =
      request.body || {};

    if (
      !isNonEmptyString(email) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(displayName) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(plateNumber)
    ) {
      reply.code(400);
      return {
        ok: false,
        error: "email, password, displayName, phone, and plateNumber are required"
      };
    }

    if (password.length < 8) {
      reply.code(400);
      return { ok: false, error: "Password must be at least 8 characters" };
    }

    if (!isMobileIdentifier(phone)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }

    // `phone` is written to the owner record, and register-call dials
    // `owner.mobile || owner.phone` — so an unverified value here is a way to
    // make ParkTag ring a number its owner never consented to. Prove control of
    // it with the same OTP the rest of the app uses before storing it. Callers
    // get the code from POST /api/auth/send-otp first; omitting it returns
    // needsOtp so a client can drive the two-step flow, matching
    // /api/owner/mobile and /api/shop/place-cod.
    if (!isNonEmptyString(otp)) {
      return { ok: false, needsOtp: true };
    }

    try {
      await verifyOtp(env, phone, String(otp).trim());
    } catch (error) {
      reply.code(400);
      return {
        ok: false,
        error: clientErrorMessage(error, "Invalid verification code.", app.log)
      };
    }

    const tag = await collections.tags.findOne({ token: request.params.token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    if (!["unclaimed", "inactive"].includes(tag.status)) {
      reply.code(400);
      return {
        ok: false,
        error: "Tag is not claimable"
      };
    }

    const existingOwner = await findByCanonicalEmail(collections.owners, email);

    if (existingOwner) {
      reply.code(400);
      return {
        ok: false,
        error: "Owner email already exists"
      };
    }

    const ownerId = new ObjectId();
    const verifiedMobile = normalizeIdentifier(phone);

    // One number, one account — the same guard /api/register-owner applies.
    // This route only checked the e-mail, so claiming a tag with a new address
    // and an already-registered number forked a second account and stranded
    // the tags on the first. /activate below has always refused this (via
    // resolveOwnerByVerifiedMobile's `conflict`); this path had not.
    const numberTaken = await findOwnerHoldingMobile(collections, verifiedMobile);

    if (numberTaken) {
      reply.code(409);
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error:
          "This mobile number is already on a ParkTag account. Please sign in with it instead, then activate this tag from your dashboard."
      };
    }

    const owner = {
      _id: ownerId,
      email,
      passwordHash: await createPasswordHash(password),
      displayName,
      // The OTP above proved this number, so store it in BOTH fields in the
      // canonical +91 form: `mobile` is the OTP-login identity, `phone` is what
      // the contact flow dials. Writing only `phone` (as this route used to)
      // left a dialable number that no login path could ever match, which is
      // how the same person ended up with two accounts.
      mobile: verifiedMobile,
      phone: verifiedMobile,
      mobileVerified: true,
      credits: 0,
      role: "owner",
      createdAt: new Date().toISOString()
    };

    try {
      await collections.owners.insertOne(owner);
    } catch (error) {
      // Lost the race to the unique index between the check above and here.
      if (!isDuplicateMobileError(error)) throw error;
      reply.code(409);
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error:
          "This mobile number is already on a ParkTag account. Please sign in with it instead, then activate this tag from your dashboard."
      };
    }

    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: {
          ownerId,
          status: "active",
          vehicleLabel: vehicleLabel || tag.vehicleLabel,
          plateNumber
        }
      }
    );

    // No-op unless this is a field-demo sticker opened for a demo. When it is,
    // it records who activated it so the sales screen can wipe them again if
    // the customer walks away. The account is always new on this path.
    await recordDemoActivation(collections, { tagId: tag._id, ownerId, isNewOwner: true });

    return {
      ok: true,
      owner: {
        email,
        displayName
      },
      tag: {
        token: tag.token,
        status: "active",
        vehicleLabel: vehicleLabel || tag.vehicleLabel,
        maskedPlateNumber: maskPlateNumber(plateNumber)
      }
    };
  });

  // Activation used by the scanner's step wizard (plate → mobile → OTP code).
  // Unlike /claim above it sets no password and takes no email: the owner is
  // identified by the WhatsApp-verified mobile — the same identity the OTP login
  // uses — so they can sign in later from /owner-login without ever setting one.
  // The OTP is the ONLY proof of identity here, so it is verified before any
  // write and its own attempt/expiry limits back the per-IP rate limit.
  app.post("/api/tags/:token/activate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    const { displayName, phone, code, plateNumber, vehicleLabel, vehicleType } =
      request.body || {};

    if (
      !isNonEmptyString(displayName) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(code) ||
      !isNonEmptyString(plateNumber)
    ) {
      reply.code(400);
      return {
        ok: false,
        error: "displayName, phone, plateNumber, and code are required"
      };
    }

    // Vehicle type is asked for on the plate step and is REQUIRED here.
    // This is the whole reason the field exists: a plate number does not encode
    // vehicle class anywhere in India, so if the wizard does not ask, the type
    // is unknowable afterwards — and every retail tag activates through this
    // route. Optional-but-skipped would leave us exactly where we started, with
    // a dashboard showing "Vehicle" and a car icon over a bike.
    //
    // Validated against the same VEHICLE_LABELS map the picker is built from,
    // so removing an option from the UI cannot be bypassed by a direct POST.
    if (!isNonEmptyString(vehicleType)) {
      reply.code(400);
      return { ok: false, error: "Choose the type of vehicle this tag is going on." };
    }
    if (!isSupportedVehicleType(vehicleType)) {
      reply.code(400);
      return { ok: false, error: "Unsupported vehicle type." };
    }

    if (!isMobileIdentifier(phone)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }

    // Store the plate the same shape the mask/last-four helpers read it back in,
    // so last-4 verification behaves identically to admin-issued plates.
    const normalizedPlate = plateNumber.replace(/\s+/g, "").toUpperCase();

    if (!/^[A-Z0-9-]{4,16}$/.test(normalizedPlate)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid number plate." };
    }

    const tag = await collections.tags.findOne({ token: request.params.token });

    if (!tag) {
      reply.code(404);
      return { ok: false, error: "Tag not found" };
    }

    if (!["unclaimed", "inactive"].includes(tag.status)) {
      reply.code(400);
      return { ok: false, error: "Tag is not claimable" };
    }

    // A windscreen sticker cannot serve a bike, and an exterior one cannot
    // serve a car. Checked here rather than only in the picker: the UI blocks
    // the pairing, but a direct POST would otherwise write a tag whose stock
    // does not fit the vehicle it is recorded against.
    //
    // Deliberately ahead of verifyOtp — the code is single-use, and spending it
    // on a request we were always going to refuse would force the owner to wait
    // out a resend before they could correct their answer.
    if (!vehicleTypeMatchesMount(tag.mountType, vehicleType)) {
      reply.code(409);
      return {
        ok: false,
        code: "mount_type_mismatch",
        error: mountMismatchMessage(tag.mountType, vehicleType),
        mountType: tag.mountType,
        vehicleType
      };
    }

    try {
      await verifyOtp(env, phone, String(code).trim());
    } catch (error) {
      const isExposable = error && error.expose === true;
      reply.code(isExposable ? 400 : 500);
      return {
        ok: false,
        error: clientErrorMessage(
          error,
          "We couldn't verify your code right now. Please try again in a moment.",
          app.log
        )
      };
    }

    const mobile = normalizeIdentifier(phone);
    const ownerName = displayName.trim();

    // Shared resolver (see lib/auth/otp.js): matches on the verified `mobile`,
    // and also reunites older accounts that only ever stored this number in
    // `phone`, so activating a sticker doesn't strand the owner's existing
    // vehicles on a duplicate account.
    const resolved = await resolveOwnerByVerifiedMobile(collections, mobile);

    if (resolved.conflict) {
      reply.code(409);
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error:
          "This number is already on an account you can sign in to with your email or Google. Please sign in that way, then activate this tag from your dashboard."
      };
    }

    let owner = resolved.owner;
    let isNewOwner = false;

    if (owner) {
      // Returning owner activating another sticker — only fill in a name if the
      // account is still using its auto-generated placeholder (the raw number).
      if (!owner.displayName || owner.displayName === mobile) {
        await collections.owners.updateOne(
          { _id: owner._id },
          { $set: { displayName: ownerName } }
        );
        owner.displayName = ownerName;
      }
    } else {
      isNewOwner = true;
      owner = {
        _id: new ObjectId(),
        displayName: ownerName,
        // `mobile` is the OTP-login identity; `phone` is what the contact flow
        // dials. Same number, both fields written so neither path has to guess.
        mobile,
        phone: mobile,
        // The OTP above proved this number, so it is safe for the dialer.
        mobileVerified: true,
        credits: 0,
        role: "owner",
        createdAt: new Date().toISOString()
      };
      try {
        await collections.owners.insertOne(owner);
      } catch (error) {
        // Two people activating stickers on the same number at once, or the
        // same person double-tapping. The account exists now either way, and
        // the OTP proved this number is theirs — so adopt it and carry on
        // rather than failing an activation that was entirely valid.
        if (!isDuplicateMobileError(error)) throw error;

        const existing = await collections.owners.findOne(
          { mobile },
          { sort: { createdAt: 1, _id: 1 } }
        );
        if (!existing) throw error;

        owner = existing;
        isNewOwner = false;
        request.log.info(
          { event: "activate-lost-create-race", ownerId: String(owner._id) },
          "[activate] concurrent request created this account first — adopting it"
        );
      }
    }

    // The label follows the type unless the caller supplied one explicitly, so
    // the dashboard reads "Bike" rather than the generic "Vehicle" it fell back
    // to while this was null.
    const resolvedLabel = vehicleLabel || VEHICLE_LABELS[vehicleType] || tag.vehicleLabel;

    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: {
          ownerId: owner._id,
          status: "active",
          vehicleType,
          vehicleLabel: resolvedLabel,
          plateNumber: normalizedPlate
        }
      }
    );

    // No-op unless this is a field-demo sticker opened for a demo — see the
    // matching call in /claim. isNewOwner matters here: a customer who already
    // had an account keeps it when the sticker is deactivated.
    await recordDemoActivation(collections, { tagId: tag._id, ownerId: owner._id, isNewOwner });

    // Log them straight in so the success screen can hand off to the dashboard.
    const sessionId = await createSession(app, {
      id: String(owner._id),
      role: "owner",
      email: owner.email || owner.mobile || mobile,
      // Activation is always a mobile-OTP sign-in, so that is what the
      // dashboard should greet them with.
      signInIdentifier: mobile,
      displayName: owner.displayName
    });
    writeSessionCookie(reply, sessionId, env.runtimeMode === "production");

    return {
      ok: true,
      isNewOwner,
      owner: { displayName: owner.displayName },
      tag: {
        token: tag.token,
        status: "active",
        vehicleType,
        // Echo what was actually stored, not a second guess at it — these two
        // drifted apart before, which is how the success screen could say
        // something the dashboard then contradicted.
        vehicleLabel: resolvedLabel,
        maskedPlateNumber: maskPlateNumber(normalizedPlate)
      }
    };
  });

  app.post("/api/contact-requests", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    // `phone` is the optional callback number — see where it is validated
    // below. Read out under a raw name so it is obvious at the call site that
    // nothing has checked it yet.
    const { token, action, messageChannel, reason, grant, phone: rawPhone } =
      request.body || {};

    // `token` and `grant` are used as raw Mongo filter values below
    // (`findOne({ token, grantId: grant, ... })` / `findOne({ token })`).
    // They must be plain strings — otherwise a crafted body such as
    // `{ "token": { "$ne": null } }` would be interpreted by Mongo as a query
    // operator instead of a literal match, letting a request match an
    // arbitrary tag/session instead of the one the caller actually verified.
    if (!isNonEmptyString(token)) {
      reply.code(400);
      return { ok: false, error: "token is required" };
    }

    // This endpoint sends the owner a WhatsApp alert, and that is all it has
    // ever done: the call branch reached createContactAction, which only ever
    // dispatches for `message`, so it registered no route, dialled nobody, and
    // returned ok — while still spending the tag's one free contact on the way
    // out. A stranger holding a grant could therefore retire an E-Tag's ability
    // to be contacted with a single request that contacted no one, and the
    // scanner page never used the branch at all (calls go to
    // /api/tags/:token/register-call, which registers a real masked route).
    //
    // Named explicitly rather than defaulted: this used to fall back to "call"
    // when the field was absent, so defaulting to "message" instead would turn
    // yesterday's silent no-op into a live notification to the owner.
    if (action !== "message") {
      reply.code(400);
      return {
        ok: false,
        error: "action must be message. Use /api/tags/:token/register-call to set up a call."
      };
    }

    // Enforce verification server-side: a valid, unexpired grant is mandatory.
    // The grant is only issued by /verify after the correct last-4 was entered,
    // so the contact flow cannot be triggered by calling this API directly.
    if (!isNonEmptyString(grant)) {
      reply.code(403);
      return { ok: false, error: "Verify the vehicle before contacting the owner." };
    }

    const grantSession = await collections.verificationSessions.findOne({
      token,
      grantId: grant,
      verified: true
    });

    if (!grantSession || new Date(grantSession.grantExpiresAt) <= new Date()) {
      reply.code(403);
      return { ok: false, error: "Your verification expired. Please verify the vehicle again." };
    }

    // The WhatsApp message body is built server-side (spec §6) — the client never
    // supplies it, so there is nothing to validate here beyond the channel.
    if (messageChannel && messageChannel !== "whatsapp") {
      reply.code(400);
      return {
        ok: false,
        error: "messageChannel must be whatsapp"
      };
    }

    // The reason selects one of a fixed set of server-authored sentences, and
    // is the only part of the owner's alert a scanner influences at all. An
    // unrecognised value is refused here rather than stored and looked up
    // later: the lookup is safe now (see reasonLabel), but a value that cannot
    // produce a sentence has no business sitting in the record support reads,
    // and this endpoint took whole objects.
    if (reason !== undefined && reason !== null && !isSupportedContactReason(reason)) {
      reply.code(400);
      return { ok: false, error: "reason is not one of the supported options." };
    }

    const tag = await collections.tags.findOne({ token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
      };
    }

    // Checked here and not only at /verify, because a grant outlives the state
    // it was issued under: it stays valid for fifteen minutes, and an owner who
    // deactivates a tag in that window (sold the vehicle, lost the sticker)
    // would otherwise still be reachable through it. register-call already
    // makes this check; this endpoint did not.
    if (tag.status !== "active") {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found or not active"
      };
    }

    // Free-usage policy (server-enforced, cannot be bypassed from the client):
    // each E-Tag includes one free masked contact. Once used, contact is blocked
    // until the owner activates the official sticker (premium).
    if (tag.freeContactUsed && !tag.premium) {
      reply.code(402);
      return {
        ok: false,
        code: "FREE_USED",
        error: "This E-Tag's free contact has already been used. The owner can re-enable contact with the official ParkTag sticker."
      };
    }

    try {
      // A callback number, if the scanner chose to leave one.
      //
      // This endpoint used to store none, on the reasoning that a one-way alert
      // does not need the sender's number and "a number this endpoint cannot
      // use is a number it has no business holding". The first half still
      // holds — delivery does not need it. The second no longer does: the owner
      // can now return contact from their dashboard, and with nothing stored
      // they were told someone had contacted them and given no way to answer.
      //
      // Optional, so the anonymous report stays exactly as it was. Never
      // revealed: the owner's dashboard shows the last four digits and the call
      // is bridged by Exotel, the same masking every other ParkTag call uses.
      //
      // Validated and normalised HERE rather than trusted from the page,
      // because this value is later dialled — the browser check is a courtesy
      // to the person typing, not a control.
      let callbackPhone = null;
      if (rawPhone !== undefined && rawPhone !== null && String(rawPhone).trim() !== "") {
        if (!isMobileIdentifier(rawPhone)) {
          reply.code(400);
          return { ok: false, error: "Enter a valid mobile number, or leave it blank." };
        }
        callbackPhone = normalizeIdentifier(rawPhone);
      }

      return await createContactAction(env, {
        token,
        phone: callbackPhone,
        action: "message",
        messageChannel: messageChannel || "whatsapp",
        reason: reason || null,
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"] || null
      });
    } catch (error) {
      // Public, unauthenticated endpoint — never echo raw error.message here.
      // Known validation failures (bad token, missing owner, provider errors)
      // already use short, deliberately-safe strings, but this catch also
      // covers unexpected exceptions (DB, network), so default to a generic
      // message and keep the real detail server-side only.
      request.log.error({ err: error }, "Contact action failed");
      reply.code(400);
      return {
        ok: false,
        error: "Could not complete this request. Please try again."
      };
    }
  });

  // Pre-register an inbound call before the scanner dials the virtual number.
  // Stores a pendingCalls record so the Dial Whom webhook can resolve the owner's
  // phone from the scanner's A-party number. Returns the virtual number to dial.
  app.post("/api/tags/:token/register-call", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { phone, grant } = request.body || {};

    if (!isNonEmptyString(phone)) {
      reply.code(400);
      return { ok: false, error: "phone is required" };
    }
    // Validated the same way every other number in the app is. toE164 below
    // will happily turn "abc" into "+" and a single digit into "+1", and a row
    // keyed on either can never match a real CallFrom — it just sits in
    // pendingCalls until it expires.
    if (!isMobileIdentifier(phone)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }
    // `grant` is used as a raw Mongo filter value below — must be a string.
    if (!isNonEmptyString(grant)) {
      reply.code(403);
      return { ok: false, error: "Verify the vehicle before contacting the owner." };
    }

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    await ensurePendingCallsIndexes(collections);

    const { token } = request.params;

    const grantSession = await collections.verificationSessions.findOne({
      token,
      grantId: grant,
      verified: true
    });
    if (!grantSession || new Date(grantSession.grantExpiresAt) <= new Date()) {
      reply.code(403);
      return { ok: false, error: "Your verification expired. Please verify the vehicle again." };
    }

    if (!(await claimGrantForPhone(collections, grantSession, toE164(phone)))) {
      reply.code(403);
      return {
        ok: false,
        code: "GRANT_IN_USE",
        error: "This verification is already in use by another number. Please verify the vehicle again."
      };
    }

    const tag = await collections.tags.findOne({ token });
    if (!tag || tag.status !== "active") {
      reply.code(404);
      return { ok: false, error: "Tag not found or not active" };
    }

    if (tag.freeContactUsed && !tag.premium) {
      reply.code(402);
      return {
        ok: false,
        code: "FREE_USED",
        error: "This E-Tag's free contact has already been used. The owner can re-enable contact with the official ParkTag sticker."
      };
    }

    if (!env.exotelCallerId) {
      reply.code(503);
      return { ok: false, error: "Call service is not configured." };
    }

    const owner = tag.ownerId ? await collections.owners.findOne({ _id: tag.ownerId }) : null;
    const ownerPhone = owner?.mobile || owner?.phone || null;
    if (!ownerPhone) {
      reply.code(422);
      return { ok: false, error: "Owner has not set a phone number. Call unavailable." };
    }

    // Normalize to E.164 so the Dial Whom lookup matches Exotel's CallFrom format.
    const callerPhone = toE164(phone);
    const now = new Date();

    // Salted with the number rather than the tag, so the value identifies the
    // client that claimed THIS number and cannot be used to follow one client
    // from one number to another.
    const registrantIpHash = hashIp(getClientIp(request), callerPhone);

    if (
      !(await claimCallerNumber(collections, {
        callerPhone,
        registrantIpHash,
        now,
        log: request.log
      }))
    ) {
      reply.code(409);
      return {
        ok: false,
        code: "CALLER_IN_USE",
        error:
          "That number already has a call waiting from another device. Please try again in a moment."
      };
    }

    const { insertedId: requestId } = await collections.contactRequests.insertOne({
      token,
      ownerId: tag.ownerId,
      phone: callerPhone,
      action: "call",
      status: "initiated",
      provider: "exotel",
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"] || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    await collections.tags.updateOne(
      { _id: tag._id },
      { $set: { freeContactUsed: true, freeContactUsedAt: now.toISOString(), updatedAt: now.toISOString() } }
    );

    await supersedePendingCalls(collections, callerPhone, token, now);

    await collections.pendingCalls.insertOne({
      callerPhone,
      registrantIpHash,
      targetPhone: ownerPhone,
      token,
      ownerId: tag.ownerId,
      requestId,
      type: "scanner_to_owner",
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
    });

    return { ok: true, virtualNumber: env.exotelCallerId };
  });

  // ── Emergency / SOS call ──────────────────────────────────────────────
  // Same masked-call mechanism as /register-call, but the pendingCalls record
  // targets the owner's EMERGENCY contact (next of kin) instead of the owner.
  // The Dial Whom webhook resolves whatever targetPhone it finds for the
  // caller, so no webhook change is needed for this second call type.
  //
  // Two deliberate differences from the ordinary owner call:
  //
  //  1. It does NOT consume, and is NOT blocked by, the free contact. This is
  //     the accident path — refusing to connect next of kin because a stranger
  //     already used the tag's one free contact would be indefensible. Abuse is
  //     bounded instead by the plate-verification grant (below), the rate limit,
  //     and the fact that the call only ever reaches a number the owner chose.
  //
  //  2. It still REQUIRES a valid grant. Without it, anyone enumerating tokens
  //     could ring a stranger's next of kin, so plate possession stays the
  //     price of entry — the scanner is standing at the vehicle either way.
  app.post("/api/tags/:token/register-emergency-call", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { phone, grant } = request.body || {};

    if (!isNonEmptyString(phone)) {
      reply.code(400);
      return { ok: false, error: "phone is required" };
    }
    // Validated the same way every other number in the app is. toE164 below
    // will happily turn "abc" into "+" and a single digit into "+1", and a row
    // keyed on either can never match a real CallFrom — it just sits in
    // pendingCalls until it expires.
    if (!isMobileIdentifier(phone)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }
    // `grant` is used as a raw Mongo filter value below — must be a string.
    if (!isNonEmptyString(grant)) {
      reply.code(403);
      return { ok: false, error: "Verify the vehicle before using the emergency call." };
    }

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { ok: false, error: "MongoDB is not configured" };
    }

    await ensurePendingCallsIndexes(collections);

    const { token } = request.params;

    const grantSession = await collections.verificationSessions.findOne({
      token,
      grantId: grant,
      verified: true
    });
    if (!grantSession || new Date(grantSession.grantExpiresAt) <= new Date()) {
      reply.code(403);
      return { ok: false, error: "Your verification expired. Please verify the vehicle again." };
    }

    if (!(await claimGrantForPhone(collections, grantSession, toE164(phone)))) {
      reply.code(403);
      return {
        ok: false,
        code: "GRANT_IN_USE",
        error: "This verification is already in use by another number. Please verify the vehicle again."
      };
    }

    const tag = await collections.tags.findOne({ token });
    if (!tag || tag.status !== "active") {
      reply.code(404);
      return { ok: false, error: "Tag not found or not active" };
    }

    if (!env.exotelCallerId) {
      reply.code(503);
      return { ok: false, error: "Call service is not configured." };
    }

    if (!isNonEmptyString(tag.emergencyContact)) {
      reply.code(422);
      return {
        ok: false,
        code: "NO_EMERGENCY_CONTACT",
        error: "This vehicle's owner has not set an emergency contact."
      };
    }

    const callerPhone = toE164(phone);
    const targetPhone = toE164(tag.emergencyContact);
    const now = new Date();

    // Salted with the number rather than the tag, so the value identifies the
    // client that claimed THIS number and cannot be used to follow one client
    // from one number to another.
    const registrantIpHash = hashIp(getClientIp(request), callerPhone);

    if (
      !(await claimCallerNumber(collections, {
        callerPhone,
        registrantIpHash,
        now,
        log: request.log
      }))
    ) {
      reply.code(409);
      return {
        ok: false,
        code: "CALLER_IN_USE",
        error:
          "That number already has a call waiting from another device. Please try again in a moment."
      };
    }

    // Daily ceiling (see MAX_EMERGENCY_CALLS_PER_DAY). Counted per tag over a
    // rolling 24h so it cannot be reset by rotating source addresses.
    //
    // Held as a counter on the tag and moved with $inc, rather than by counting
    // contactRequests rows before writing one. A count-then-insert reads a
    // total that concurrent requests are still changing, so a burst of
    // simultaneous calls all read the same number and all pass a ceiling only
    // one of them should have — the same defect, and the same fix, as the
    // verification buckets at the top of this file.
    //
    // The fast path below refuses out of the value already on the tag, so a
    // request that arrives at a spent ceiling costs nothing. Only requests that
    // were already in flight get as far as reserving, which is why the
    // authoritative test is on the reserved total.
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const windowStart = tag.emergencyWindowStart ? new Date(tag.emergencyWindowStart) : null;
    const windowLive = windowStart && windowStart > dayAgo;
    const usedBeforeThis = windowLive ? tag.emergencyWindowCount || 0 : 0;

    const refuseOverCap = (count) => {
      request.log.warn(
        {
          event: "emergency-call-cap-hit",
          token,
          ownerId: tag.ownerId ? String(tag.ownerId) : null,
          count
        },
        "[emergency] per-tag daily SOS ceiling reached — refusing further calls"
      );
      reply.code(429);
      return {
        ok: false,
        code: "EMERGENCY_LIMIT",
        error:
          "This vehicle's emergency contact has already been called several times today. If this is a real emergency, please call 112."
      };
    };

    if (usedBeforeThis >= MAX_EMERGENCY_CALLS_PER_DAY) {
      return refuseOverCap(usedBeforeThis);
    }

    // Roll the day when it has run out, with the staleness test in the filter so
    // Mongo settles concurrent rolls: the first request through resets the
    // count and a second no longer matches, then increments the fresh one. The
    // missing-field case is the same reset, for a tag that has never had one.
    await collections.tags.updateOne(
      {
        _id: tag._id,
        $or: [
          { emergencyWindowStart: { $exists: false } },
          { emergencyWindowStart: { $lte: dayAgo.toISOString() } }
        ]
      },
      { $set: { emergencyWindowStart: now.toISOString(), emergencyWindowCount: 0 } }
    );

    const reserved = await collections.tags.findOneAndUpdate(
      { _id: tag._id },
      { $inc: { emergencyWindowCount: 1 } },
      { returnDocument: "after", projection: { emergencyWindowCount: 1 } }
    );
    const usedToday = reserved?.emergencyWindowCount || 0;

    // Strictly greater: the fifth call of the day is the last one allowed, and
    // it is allowed. A refusal here leaves the reservation spent, which is the
    // conservative direction for a ceiling and settles once the window rolls.
    if (usedToday > MAX_EMERGENCY_CALLS_PER_DAY) {
      return refuseOverCap(usedToday);
    }

    const { insertedId: requestId } = await collections.contactRequests.insertOne({
      token,
      ownerId: tag.ownerId || null,
      phone: callerPhone,
      action: "emergency_call",
      status: "initiated",
      provider: "exotel",
      ipAddress: getClientIp(request),
      userAgent: request.headers["user-agent"] || null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    });

    // Note the absence of a tags.freeContactUsed write here — see (1) above.
    await collections.tags.updateOne(
      { _id: tag._id },
      {
        $set: { lastEmergencyAt: now.toISOString(), updatedAt: now.toISOString() },
        $inc: { emergencyAttempts: 1 }
      }
    );

    await supersedePendingCalls(collections, callerPhone, token, now);

    await collections.pendingCalls.insertOne({
      callerPhone,
      registrantIpHash,
      targetPhone,
      token,
      ownerId: tag.ownerId || null,
      requestId,
      type: "scanner_to_emergency",
      consumed: false,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000)
    });

    // ownerId is recorded deliberately: the owner chose the number this dials,
    // so if SOS is ever used to harass someone, this is the line that says who
    // pointed it there. `usedToday` makes a ramping pattern visible in the logs
    // before the ceiling is hit.
    request.log.info(
      {
        event: "emergency-call-registered",
        token,
        requestId: String(requestId),
        ownerId: tag.ownerId ? String(tag.ownerId) : null,
        usedToday,
        dailyCap: MAX_EMERGENCY_CALLS_PER_DAY
      },
      "[emergency] pending SOS call registered"
    );

    return { ok: true, virtualNumber: env.exotelCallerId };
  });

  // ── Tag reports ───────────────────────────────────────────────────────
  // Public form on /report-tag. Anyone standing at a vehicle can flag that the
  // tag is stale (sold on) or being misused, without an account.

  // The site key is public by definition — it is embedded in the widget markup
  // Google renders. Only the secret stays server-side.
  app.get("/api/recaptcha/v2-config", async (_request, reply) => {
    reply.send({ siteKey: env.recaptchaV2SiteKey || "" });
  });

  app.post(
    "/api/tags/:token/report",
    { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } },
    async (request, reply) => {
      const collections = await getCollections(env);

      if (!collections) {
        reply.code(500);
        return { ok: false, error: "MongoDB is not configured" };
      }

      const { token } = request.params;
      const body = request.body || {};
      const reason = String(body.reason || "").trim();
      const details = String(body.details || "").trim().slice(0, 1000);
      const name = String(body.name || "").trim().slice(0, 80);
      const phoneDigits = String(body.phone || "").replace(/\D/g, "");

      if (!REPORT_REASONS.includes(reason)) {
        reply.code(400);
        return { ok: false, error: "Choose a reason for the report." };
      }

      if (!name) {
        reply.code(400);
        return { ok: false, error: "Enter your name." };
      }

      // Indian mobile numbers are 10 digits; accept a 91/+91 prefix too since
      // people type their number both ways.
      const normalizedPhone =
        phoneDigits.length === 12 && phoneDigits.startsWith("91")
          ? phoneDigits.slice(2)
          : phoneDigits;

      if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
        reply.code(400);
        return { ok: false, error: "Enter a valid 10-digit phone number." };
      }

      const captcha = await verifyRecaptchaV2(env, body.captchaToken, {
        remoteIp: getClientIp(request)
      });

      if (!captcha.ok) {
        reply.code(400);
        return { ok: false, error: "Please complete the reCAPTCHA and try again." };
      }

      const tag = await collections.tags.findOne({ token });

      if (!tag) {
        reply.code(404);
        return { ok: false, error: "This tag could not be found." };
      }

      // The reporter's own number is stored so support can call back — it is
      // never returned to any scan page, and the owner is not notified here.
      // A report is an accusation; it goes to us, not to the person accused.
      await collections.tagReports.insertOne({
        token,
        tagId: tag._id,
        ownerId: tag.ownerId || null,
        reason,
        details: details || null,
        reporterName: name,
        reporterPhone: `+91${normalizedPhone}`,
        status: "open",
        ipHash: hashIp(getClientIp(request), token),
        createdAt: new Date().toISOString()
      });

      request.log.info(
        { event: "tag-report-submitted", token, reason },
        "[report] tag report received"
      );

      return { ok: true };
    }
  );
}

function toE164(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}
