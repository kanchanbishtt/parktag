import { ObjectId } from "mongodb";

import { createContactAction } from "../../lib/core/contact-actions.js";
import { createPasswordHash, createSecureToken, safeEqual, hashIp, minutesFromNow, getClientIp, maskPlateNumber, getPlateLastFour, isNonEmptyString } from "../../lib/auth/security.js";
import { createSession, writeSessionCookie } from "../../lib/auth/session.js";
import {
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
  vehicleCategoryForMount
} from "../../lib/core/tag-issuance.js";
import { verifyRecaptchaV2 } from "../../lib/integrations/recaptcha.js";
import { clientErrorMessage } from "../../lib/errors.js";

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
// means the existing { token, ipHash } index and TTL cleanup already cover it.
const TAG_BUCKET_KEY = "*";

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

    let session = await collections.verificationSessions.findOne({ token, ipHash });
    const tagBucket = await collections.verificationSessions.findOne({
      token,
      ipHash: TAG_BUCKET_KEY
    });

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

    const expected = getPlateLastFour(tag.plateNumber) || "";
    const isMatch = expected.length === 4 && safeEqual(lastFour, expected);

    if (!session) {
      session = {
        _id: new ObjectId(),
        token,
        ipHash,
        attempts: 0,
        lockedUntil: null,
        verified: false,
        grantId: null,
        grantExpiresAt: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
      };
      await collections.verificationSessions.insertOne(session);
    }

    if (!isMatch) {
      const attempts = (session.attempts || 0) + 1;
      const willLock = attempts >= MAX_VERIFY_ATTEMPTS;

      await collections.verificationSessions.updateOne(
        { _id: session._id },
        {
          $set: {
            attempts: willLock ? 0 : attempts,
            lockedUntil: willLock ? minutesFromNow(LOCKOUT_MINUTES).toISOString() : null,
            updatedAt: now.toISOString(),
            expiresAt: minutesFromNow(SESSION_TTL_MINUTES)
          }
        }
      );

      // Per-tag ceiling, counted across every IP (see MAX_TAG_ATTEMPTS_PER_WINDOW).
      // The window rolls: once it has elapsed the count restarts, so a slow
      // trickle of genuine mistakes never accumulates into a lockout.
      const windowStart = tagBucket && tagBucket.windowStart ? new Date(tagBucket.windowStart) : null;
      const windowLive = windowStart && now - windowStart < TAG_WINDOW_MINUTES * 60 * 1000;
      const tagAttempts = (windowLive ? tagBucket.attempts || 0 : 0) + 1;
      const tagWillLock = tagAttempts >= MAX_TAG_ATTEMPTS_PER_WINDOW;

      await collections.verificationSessions.updateOne(
        { token, ipHash: TAG_BUCKET_KEY },
        {
          $set: {
            attempts: tagWillLock ? 0 : tagAttempts,
            windowStart: (windowLive ? windowStart : now).toISOString(),
            lockedUntil: tagWillLock ? minutesFromNow(TAG_LOCKOUT_MINUTES).toISOString() : null,
            updatedAt: now.toISOString(),
            expiresAt: minutesFromNow(TAG_WINDOW_MINUTES + TAG_LOCKOUT_MINUTES)
          },
          $setOnInsert: { token, ipHash: TAG_BUCKET_KEY, verified: false, grantId: null }
        },
        { upsert: true }
      );

      if (tagWillLock) {
        request.log.warn(
          { event: "tag-verify-bruteforce", token },
          "[verify] per-tag attempt ceiling hit — tag locked across all IPs"
        );
      }

      if (willLock || tagWillLock) {
        const minutes = tagWillLock ? TAG_LOCKOUT_MINUTES : LOCKOUT_MINUTES;
        reply.code(423);
        return {
          ok: false,
          locked: true,
          error: `Too many incorrect attempts. Try again in ${minutes} minutes.`
        };
      }

      reply.code(401);
      return {
        ok: false,
        error: "Those last 4 digits do not match this vehicle.",
        attemptsRemaining: MAX_VERIFY_ATTEMPTS - attempts
      };
    }

    // Success — issue a fresh grant.
    const grantId = createSecureToken();
    await collections.verificationSessions.updateOne(
      { _id: session._id },
      {
        $set: {
          attempts: 0,
          lockedUntil: null,
          verified: true,
          grantId,
          grantExpiresAt: minutesFromNow(GRANT_TTL_MINUTES).toISOString(),
          // A fresh grant starts with a clean set of caller numbers. The session
          // document is keyed by { token, ipHash } and reused across verifies,
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
    // tip a legitimately-used tag into a lockout later in the window.
    if (tagBucket && (tagBucket.attempts || 0) > 0) {
      await collections.verificationSessions.updateOne(
        { token, ipHash: TAG_BUCKET_KEY },
        { $set: { attempts: 0, windowStart: now.toISOString(), lockedUntil: null } }
      );
    }

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

    const existingOwner = await collections.owners.findOne({ email });

    if (existingOwner) {
      reply.code(400);
      return {
        ok: false,
        error: "Owner email already exists"
      };
    }

    const ownerId = new ObjectId();
    const verifiedMobile = normalizeIdentifier(phone);
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

    await collections.owners.insertOne(owner);

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
      await collections.owners.insertOne(owner);
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

    // Log them straight in so the success screen can hand off to the dashboard.
    const sessionId = await createSession(app, {
      id: String(owner._id),
      role: "owner",
      email: owner.email || owner.mobile || mobile,
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

    const { token, phone, action, messageChannel, reason, grant } = request.body || {};
    const resolvedAction = action || "call";

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

    // A call needs the scanner's number (to masked-call them). A WhatsApp
    // notification goes to the owner, so the scanner's number is not required.
    if (resolvedAction === "call" && !isNonEmptyString(phone)) {
      reply.code(400);
      return { ok: false, error: "phone is required for a call" };
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

    if (action && !["call", "message"].includes(action)) {
      reply.code(400);
      return {
        ok: false,
        error: "action must be call or message"
      };
    }

    // The WhatsApp message body is built server-side (spec §6) — the client never
    // supplies it, so there is nothing to validate here beyond the channel.
    if (
      resolvedAction === "message" &&
      messageChannel &&
      messageChannel !== "whatsapp"
    ) {
      reply.code(400);
      return {
        ok: false,
        error: "messageChannel must be whatsapp"
      };
    }

    const tag = await collections.tags.findOne({ token });

    if (!tag) {
      reply.code(404);
      return {
        ok: false,
        error: "Tag not found"
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
      // Normalize to digits-only E.164 before persisting — this is a free-text
      // body field on a public, unauthenticated endpoint, and the raw value
      // used to be stored verbatim (only later fixed on the *output* side with
      // HTML-escaping in the admin dashboard). Constraining the input format
      // here removes the underlying bad data at the source too.
      const normalizedPhone = isNonEmptyString(phone) ? toE164(phone) : null;
      return await createContactAction(env, {
        token,
        phone: normalizedPhone,
        action: resolvedAction,
        messageChannel: resolvedAction === "message" ? (messageChannel || "whatsapp") : null,
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

    // Daily ceiling (see MAX_EMERGENCY_CALLS_PER_DAY). Counted per tag over a
    // rolling 24h so it cannot be reset by rotating source addresses.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const emergencyToday = await collections.contactRequests.countDocuments({
      token,
      action: "emergency_call",
      createdAt: { $gte: dayAgo }
    });

    if (emergencyToday >= MAX_EMERGENCY_CALLS_PER_DAY) {
      request.log.warn(
        {
          event: "emergency-call-cap-hit",
          token,
          ownerId: tag.ownerId ? String(tag.ownerId) : null,
          count: emergencyToday
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
    }

    const callerPhone = toE164(phone);
    const targetPhone = toE164(tag.emergencyContact);
    const now = new Date();

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
        usedToday: emergencyToday + 1,
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
