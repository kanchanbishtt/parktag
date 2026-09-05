import crypto from "node:crypto";

import { getCollections } from "../db/repositories.js";
import { toE164 } from "../core/phone.js";
import { sendOtpEmail } from "../integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOtp } from "../integrations/meta.js";
import { clientError } from "../errors.js";
import {
  maskIdentifier,
  redactText,
  safeEqual,
  createOtpHash,
  verifyOtpHash,
  burnHashComparison
} from "./security.js";
import { canonicalEmail, findByCanonicalEmail } from "./identity.js";

const OTP_EXPIRY_MS = 10 * 60 * 1000;
const RATE_LIMIT_MS = 2 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
// Hard cap on how many codes a single destination (phone/email) can be sent in a
// rolling window, regardless of source IP. The per-route @fastify/rate-limit
// configs are keyed on the caller's IP, so an attacker rotating IPs could still
// bomb one victim's phone with SMS/WhatsApp (harassment + real per-message cost).
// This cap is enforced in the DB against the destination itself, so it holds no
// matter how many IPs the requests come from. Sits above the 2-min reuse
// throttle below: legit resends within 2 min reuse the existing code and never
// reach this counter, so a normal login/verify flow stays well under the cap.
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MS = 60 * 60 * 1000;

// What a code is allowed to do. A code is issued for one purpose and verifies
// only against that purpose.
//
// Without this, every six-digit code in the system is interchangeable: the one
// mailed out as "your sign-in code" would also confirm permanent deletion of
// the account. Those two are indistinguishable to someone who has been talked
// into reading a code down the phone, and only one of them is irreversible.
// Scoping them means a code obtained under a sign-in pretext buys a sign-in,
// and deleting still requires a second code the attacker has to intercept
// separately.
export const OTP_PURPOSE_AUTH = "auth";
export const OTP_PURPOSE_DELETE_ACCOUNT = "delete-account";
// Proving control of a delivery phone so a COD order can be placed, and proving
// control of a number before it is linked to an account. Neither is a sign-in,
// and before they had their own purposes both minted ordinary `auth` codes —
// so the code the shop sent to a delivery number was a working login credential
// for whoever held it. The delivery number is typed into the address form by
// the person checking out, which made it a way to have ParkTag send a
// login-capable code, worded as a sign-in code, to any number they chose.
export const OTP_PURPOSE_COD_VERIFY = "cod-verify";
export const OTP_PURPOSE_LINK_MOBILE = "link-mobile";

// Tokens issued before purposes existed carry no `purpose` field at all. They
// are sign-in codes by definition — nothing else could issue one — so the auth
// filter has to match a missing field as well as an explicit "auth". In Mongo a
// `null` inside `$in` matches both null and absent, which is what that does.
// The branch stops being reachable ten minutes after the deploy that adds this,
// since no token outlives OTP_EXPIRY_MS.
function purposeFilter(purpose) {
  return purpose === OTP_PURPOSE_AUTH ? { $in: [OTP_PURPOSE_AUTH, null] } : purpose;
}

function generateOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

export function isMobileIdentifier(identifier) {
  const stripped = String(identifier || "").trim().replace(/[\s\-()]/g, "");
  if (stripped.includes("@")) return false;
  return /^\+?\d{7,15}$/.test(stripped);
}

function normalizePhone(input) {
  // Canonicalised by core/phone.js, which is the one place that knows the
  // trunk zero exists. The cases this used to handle inline — a leading +, a
  // bare ten digits, twelve beginning 91 — are all still handled there; what
  // it could not do was recognise 0XXXXXXXXXX, so that spelling became its own
  // identity and one person could hold two accounts.
  //
  // TOTAL, and deliberately so. toE164 returns null for anything it cannot
  // read, but this decides an account identifier and every caller assumes a
  // string. Junk that got past isMobileIdentifier keeps its old behaviour —
  // the scrubbed digits, unchanged — rather than becoming null and turning a
  // bad login into a crash.
  const raw = String(input ?? "").trim().replace(/[^\d+]/g, "");
  return toE164(input) ?? raw;
}

// `identifier` is whatever arrived in the JSON body — the route only checks it
// is truthy, and a non-empty ARRAY or OBJECT is truthy. Calling .trim() on one
// threw `identifier.trim is not a function`, which surfaced as a 500 on
// /api/auth/send-otp and /api/auth/verify-otp for anything that wasn't a
// string. Coerce instead: a junk identifier must be a 400, not a server error.
// (It never reached Mongo — the throw happened first — so this was a wrong
// status code and log noise rather than an injection hole, but a 500 on the
// login path invites client retries and buries genuine faults in the metrics.)
export function normalizeIdentifier(identifier) {
  if (isMobileIdentifier(identifier)) return normalizePhone(identifier);
  // Same canonicaliser the password path uses. Previously this lowercased here
  // while findUserByEmail matched the raw string, so the two paths resolved the
  // same address to different accounts.
  return canonicalEmail(String(identifier ?? ""));
}

export async function sendOtp(env, identifier, { purpose = OTP_PURPOSE_AUTH } = {}) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  // Per-purpose, so that asking to delete an account moments after signing in
  // does not hand back "already sent" and leave the person waiting for a
  // deletion code that was never dispatched.
  const recent = await collections.otpTokens.findOne({
    identifier: normalized,
    purpose: purposeFilter(purpose),
    used: false,
    expiresAt: { $gt: new Date().toISOString() },
    createdAt: { $gt: new Date(Date.now() - RATE_LIMIT_MS).toISOString() }
  });

  if (recent) return { ok: true };

  // Per-destination flood cap (see MAX_SENDS_PER_WINDOW). Count actual sends —
  // each real send inserts exactly one token, and reuse hits above return before
  // inserting — so this equals the number of messages dispatched to this
  // destination in the window, across every IP.
  //
  // Deliberately NOT filtered by purpose: the cap protects the person receiving
  // the messages, and their handset does not care what each code was for. One
  // budget per destination means a second purpose cannot double the number of
  // messages that can be aimed at one victim.
  const windowStart = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
  const sentInWindow = await collections.otpTokens.countDocuments({
    identifier: normalized,
    createdAt: { $gt: windowStart }
  });
  if (sentInWindow >= MAX_SENDS_PER_WINDOW) {
    throw clientError(
      "Too many verification codes requested. Please wait a while before trying again."
    );
  }

  const code = generateOtp();
  const now = new Date();

  // `codeHash`, never `code`. The plaintext lives only in this function and in
  // the message that carries it to the user; nothing recoverable is persisted.
  // The resend path above returns before reaching here, so no caller ever needs
  // to read a previously issued code back out.
  const inserted = await collections.otpTokens.insertOne({
    identifier: normalized,
    purpose,
    codeHash: await createOtpHash(code),
    used: false,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString()
  });

  if (isMobile) {
    if (isMetaWhatsappConfigured(env)) {
      // The WhatsApp body is a Meta-approved template ("parktag_login"), so its
      // wording cannot be varied per purpose from here — a deletion code still
      // arrives worded as a sign-in code until a second template is approved.
      // The scoping above is what actually constrains the code; this is only a
      // wording gap, and the email channel below does say the right thing.
      try {
        await sendMetaWhatsappOtp(env, { to: normalized, code });
      } catch (err) {
        console.error("[OTP] WhatsApp send failed:", err?.message, err?.providerDetail);
        await collections.otpTokens.deleteOne({ _id: inserted.insertedId });
        throw clientError("Could not send WhatsApp OTP. Please try again.");
      }
    } else if (env.runtimeMode !== "production") {
      // Dev-only fallback so the flow is testable without WhatsApp configured.
      // Identifier is masked — only the OTP itself needs to be readable here.
      console.log(`\n[ParkTag] Dev OTP for ${maskIdentifier(normalized)}: ${code}\n`);
    } else {
      throw clientError("WhatsApp OTP is not configured on this server.");
    }
  } else {
    sendOtpEmail(env, { to: normalized, code, purpose })
      .catch(err => console.error("[OTP] Email send failed:", redactText(err?.message || String(err))));
  }

  return { ok: true };
}

// Resolve the owner account behind a mobile number whose control has JUST been
// proven by an OTP.
//
// The problem this solves: `mobile` is the OTP-login identity, but older
// accounts were created by paths that wrote only `phone` (registration, tag
// claim). A plain findOne({ mobile }) missed those, so an owner who signed up
// with email + password + phone and later signed in with a mobile OTP got a
// brand-new EMPTY second account, silently splitting their vehicles and orders.
//
// Matching those accounts by `phone` is only safe when the phone is real
// evidence of ownership. On legacy records it is an unverified free-text claim
// — someone could have typed a stranger's number at signup — so adopting one
// that still has a password or a linked Google account would hand the person
// holding the OTP an account that somebody else can also sign into (and vice
// versa). Hence three outcomes:
//
//   • matched  — a genuine `mobile` match, or a legacy `phone` match on an
//                account with NO other credential (nothing else can open it,
//                so proving the number proves ownership). Legacy hits are
//                upgraded in place so this only happens once.
//   • conflict — legacy `phone` match on an account that DOES have another way
//                in. Neither forking a duplicate nor silently adopting is
//                right; the caller tells the user to sign in the way they
//                already can and link the number from Settings, which is what
//                the OTP-gated POST /api/owner/mobile is for.
//   • null     — nobody owns this number yet; the caller creates a new owner.
// Every spelling a number may have been stored under. Legacy `phone` values
// were never normalised, so a lookup that only tries the canonical +91 form
// misses the rows most likely to be duplicates.
export function storedPhoneVariants(normalizedMobile) {
  const digits = String(normalizedMobile).replace(/\D/g, "");
  const last10 = digits.slice(-10);
  // `0${last10}` is not a spelling anyone typed on purpose — it is what the
  // old normalizePhone WROTE. It had no case for the domestic trunk prefix, so
  // an eleven-digit 0XXXXXXXXXX fell through and was stored verbatim as the
  // account's mobile. Those rows are real and they predate the fix; leaving
  // them out of this list would hide an existing account from its owner and
  // let them register a second one, which is the exact failure
  // one-number-one-account.test.js exists to prevent.
  return [normalizedMobile, digits, last10, `+${digits}`, `0${last10}`].filter(Boolean);
}

// Is this number already attached to an account?
//
// The one guard both account-CREATING routes share. /api/register-owner and
// /api/tags/:token/claim each checked that the e-mail was free and said nothing
// about the number, so registering a second time with a new address minted
// another account holding the same mobile. Two rows, one number, and a sign-in
// lookup that is `findOne` with no sort — so which account the person landed on
// came down to row order. That is not a hypothetical: it is what put a real
// customer on an empty dashboard while their tag sat on the other record.
//
// Matches `mobile` OR any legacy `phone` spelling, because a duplicate is a
// duplicate whichever field it landed in.
//
// Deliberately NOT anti-enumeration-shy. Every caller runs this AFTER an OTP
// has proved control of the number, so the person already knows whether it is
// theirs — telling them an account exists reveals nothing they did not just
// demonstrate, and the alternative is a silent duplicate.
export async function findOwnerHoldingMobile(collections, normalizedMobile) {
  const variants = storedPhoneVariants(normalizedMobile);
  return collections.owners.findOne({
    $or: [{ mobile: { $in: variants } }, { phone: { $in: variants } }]
  });
}

// Is there ANOTHER account carrying this number that the sign-in just walked
// past?
//
// The guards above stop new splits; they cannot undo one that already exists.
// When an old row holds the number as a raw `phone` and a newer row holds it as
// `mobile`, sign-in resolves the newer one and the older one's vehicles simply
// do not appear — which is precisely the report that started all this, and it
// arrived as "my tag is missing" rather than as an error anyone could see.
//
// Merging them is not something a login may decide: both rows can carry their
// own password, and picking one would hand somebody an account another person
// can also open. So this does not change who signs in. It makes the situation
// legible — a warning naming both ids, so support can find these before the
// customer does instead of after.
export async function findShadowedSiblings(collections, normalizedMobile, resolvedOwnerId) {
  const variants = storedPhoneVariants(normalizedMobile);
  return collections.owners
    .find(
      {
        _id: { $ne: resolvedOwnerId },
        $or: [{ mobile: { $in: variants } }, { phone: { $in: variants } }]
      },
      { projection: { _id: 1, email: 1 } }
    )
    .toArray();
}

// Did this write lose a race to the `mobile_unique` index?
//
// findOwnerHoldingMobile closes the gap for anything sequential, but two
// requests carrying the same number can both pass it and only one can insert.
// Without this the loser surfaced a raw E11000 as a 500 — a server error for
// something the system handled exactly right.
//
// Keyed off `keyPattern` rather than the message text, so it cannot start
// matching some other collection's duplicate the day a message is reworded.
export function isDuplicateMobileError(error) {
  return Boolean(error && error.code === 11000 && error.keyPattern && error.keyPattern.mobile);
}

export async function resolveOwnerByVerifiedMobile(collections, normalizedMobile) {
  // Oldest first, so a number that somehow ends up on two rows always resolves
  // to the same one. Unsorted findOne let the answer change between calls on
  // identical data — the tag holder on one request, an empty account on the
  // next. The unique index in db/repositories.js is what stops the second row
  // existing; this is what keeps the answer stable if one ever does.
  const owner = await collections.owners.findOne(
    { mobile: normalizedMobile },
    { sort: { createdAt: 1, _id: 1 } }
  );
  if (owner) return { owner, adopted: false, conflict: false };

  // Legacy `phone` values were never normalised, so match the stored variants.
  // Uses storedPhoneVariants rather than repeating its list: this copy had
  // already fallen behind it once.
  const legacy = await collections.owners.findOne({
    mobile: { $in: [null, ""] },
    phone: { $in: storedPhoneVariants(normalizedMobile) }
  });

  if (!legacy) return { owner: null, adopted: false, conflict: false };

  if (legacy.passwordHash || legacy.googleId) {
    return { owner: null, adopted: false, conflict: true };
  }

  await collections.owners.updateOne(
    { _id: legacy._id },
    { $set: { mobile: normalizedMobile, phone: normalizedMobile, mobileVerified: true } }
  );

  return {
    owner: { ...legacy, mobile: normalizedMobile, phone: normalizedMobile, mobileVerified: true },
    adopted: true,
    conflict: false
  };
}

// Charge one OTP send against a destination's budget WITHOUT this app being the
// sender — used by the Firebase phone-auth path, where Firebase dispatches the
// SMS itself and so never reaches sendOtp()'s per-destination cap above. Left
// unmetered, that route was an unauthenticated way to have SMS sent to any
// number on demand, which is exactly the abuse MAX_SENDS_PER_WINDOW exists to
// stop on the WhatsApp path.
//
// The marker is written into otpTokens so both channels share ONE budget per
// destination (a victim can't be given twice the messages by alternating
// channels). It is stored `used: true` with no code, so neither verifyOtp's
// lookup nor sendOtp's reuse check can ever mistake it for a live code, while
// sendOtp's window count — which filters on identifier and createdAt only —
// still counts it.
export async function chargeExternalOtpSend(env, identifier) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const windowStart = new Date(Date.now() - SEND_WINDOW_MS).toISOString();
  const sentInWindow = await collections.otpTokens.countDocuments({
    identifier: normalized,
    createdAt: { $gt: windowStart }
  });

  if (sentInWindow >= MAX_SENDS_PER_WINDOW) {
    throw clientError(
      "Too many verification codes requested. Please wait a while before trying again."
    );
  }

  const now = new Date();
  await collections.otpTokens.insertOne({
    identifier: normalized,
    purpose: OTP_PURPOSE_AUTH,
    code: null,
    channel: "firebase",
    used: true,
    attempts: 0,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + OTP_EXPIRY_MS).toISOString()
  });

  return { ok: true };
}

export async function verifyOtp(env, identifier, code, { purpose = OTP_PURPOSE_AUTH } = {}) {
  const collections = await getCollections(env);
  if (!collections) throw new Error("MongoDB is not configured");

  const normalized = normalizeIdentifier(identifier);
  const isMobile = isMobileIdentifier(identifier);

  // Find the token without the code first so we can count failed attempts.
  // Always verify against the MOST RECENT unused code: a user who taps "resend"
  // after the send rate-limit window can hold more than one valid token at once,
  // and an unsorted findOne returns the oldest — so the freshly-sent code would
  // be checked against a stale token and wrongly rejected as invalid.
  const record = await collections.otpTokens.findOne({
    identifier: normalized,
    purpose: purposeFilter(purpose),
    used: false,
    expiresAt: { $gt: new Date().toISOString() }
  }, { sort: { createdAt: -1 } });

  if (!record) {
    // Pay for the comparison there is no token to make. Returning straight away
    // answered in ~30ms where a real check costs ~290ms, and that gap says
    // whether the address has a code outstanding — i.e. whether that person is
    // part-way through signing in right now, which is a targeting signal for
    // someone phoning them pretending to be support.
    //
    // The gap existed before codes were hashed, but was small when the compare
    // was safeEqual; bcrypt widened it to the point of being trivially readable.
    await burnHashComparison(code);
    throw clientError("Invalid or expired code. Please try again.");
  }

  // Enforce attempt limit
  if ((record.attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $set: { used: true } }
    );
    throw clientError("Too many incorrect attempts. Please request a new code.");
  }

  // Codes are stored hashed. `record.code` is only present on tokens issued
  // before that change; they expire ten minutes after the deploy that
  // introduced it, so this fallback is short-lived but has to exist — without
  // it, everyone mid-login at deploy time is told their valid code is wrong.
  //
  // Both branches are constant-time: bcrypt.compare is, and safeEqual returns
  // false on a length mismatch rather than short-circuiting on the first
  // differing byte, so the correct code can't be recovered digit-by-digit.
  let matches;

  if (record.codeHash) {
    matches = await verifyOtpHash(code, record.codeHash);
  } else {
    // Legacy path, and it should stop being reached ten minutes after the
    // deploy that introduced hashing — no token issued since then carries a
    // plaintext `code`, and none lives longer than OTP_EXPIRY_MS. Logged so its
    // use is observable: once this stops appearing, the branch (and the
    // plaintext it accepts) can be deleted.
    console.warn(
      "[OTP] verified a pre-hashing token holding a plaintext code — " +
        "safe to remove this fallback once these stop appearing"
    );
    matches = safeEqual(record.code, code);
  }

  if (!matches) {
    await collections.otpTokens.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } }
    );
    const remaining = MAX_VERIFY_ATTEMPTS - (record.attempts || 0) - 1;
    throw clientError(
      `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
    );
  }

  await collections.otpTokens.updateOne(
    { _id: record._id },
    { $set: { used: true, usedAt: new Date().toISOString() } }
  );

  // Canonical lookup, so an account stored with a mixed-case address is found
  // rather than missed. Missing it here is what forked a second, empty account
  // for someone who registered as "Name@example.com" and later signed in with a
  // code — the route below creates an owner whenever this returns nothing.
  const owner = isMobile
    // Same deterministic order as resolveOwnerByVerifiedMobile. These two
    // lookups decide the same question on the same data and must never
    // disagree; unsorted, they could pick different rows on the same request.
    ? await collections.owners.findOne(
        { mobile: normalized },
        { sort: { createdAt: 1, _id: 1 } }
      )
    : await findByCanonicalEmail(collections.owners, normalized);

  return {
    ok: true,
    isNewUser: !owner,
    owner: owner || null
  };
}
