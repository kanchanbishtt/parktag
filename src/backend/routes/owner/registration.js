import { ObjectId } from "mongodb";

import { createPasswordHash, isNonEmptyString } from "../../lib/auth/security.js";
import {
  findOwnerHoldingMobile,
  isDuplicateMobileError,
  isMobileIdentifier,
  normalizeIdentifier,
  verifyOtp
} from "../../lib/auth/otp.js";
import { getCollections } from "../../lib/db/repositories.js";
import { clientErrorMessage } from "../../lib/errors.js";
import { findByCanonicalEmail, canonicalEmail } from "../../lib/auth/identity.js";
import {
  buildIssuedTagOutput,
  createRegisteredOwnerTag
} from "../../lib/core/tag-issuance.js";

export function registerRegistrationRoutes(app, env) {
  app.post("/api/register-owner", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const collections = await getCollections(env);

    if (!collections) {
      reply.code(500);
      return {
        ok: false,
        error: "MongoDB is not configured"
      };
    }

    const {
      displayName,
      email,
      password,
      phone,
      vehicleLabel,
      plateNumber,
      stickerRequested,
      otp
    } = request.body || {};

    if (
      !isNonEmptyString(displayName) ||
      !isNonEmptyString(email) ||
      !isNonEmptyString(password) ||
      !isNonEmptyString(phone) ||
      !isNonEmptyString(plateNumber)
    ) {
      reply.code(400);
      return {
        ok: false,
        error:
          "displayName, email, password, phone, and plateNumber are required"
      };
    }

    // Match the password-reset flow's minimum so a weak password can't be set
    // at registration but blocked on reset.
    if (password.length < 8) {
      reply.code(400);
      return {
        ok: false,
        error: "Password must be at least 8 characters"
      };
    }

    if (!isMobileIdentifier(phone)) {
      reply.code(400);
      return { ok: false, error: "Enter a valid mobile number." };
    }

    // `phone` lands on the owner record, and register-call dials
    // `owner.mobile || owner.phone` — so accepting it unverified was a way to
    // make ParkTag ring a number whose owner never agreed to it. Require the
    // same OTP the rest of the app uses. Callers fetch the code from
    // POST /api/auth/send-otp first; omitting it returns needsOtp so a client
    // can drive the two-step flow (same contract as /api/owner/mobile).
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

    // Hash the password BEFORE the existence check so a duplicate email and a
    // fresh one take about the same time (bcrypt dominates the request). Doing
    // the check first would let a duplicate return early and measurably faster,
    // re-enabling account enumeration by timing despite the generic message.
    const passwordHash = await createPasswordHash(password);

    // `email` is used as a raw Mongo filter value just below — reject non-string
    // input above so a crafted body can't be interpreted as a query operator.
    const existingOwner = await findByCanonicalEmail(collections.owners, email);

    if (existingOwner) {
      // Don't confirm the email is already registered — an explicit "email
      // already exists" turns this into an account-enumeration oracle. Return a
      // generic message (the forgot-password flow is likewise non-committal),
      // backed by the 5/min rate limit on this route.
      reply.code(400);
      return {
        ok: false,
        error:
          "We couldn't complete your registration. If you already have an account, please sign in or reset your password."
      };
    }

    const ownerId = new ObjectId();
    const verifiedMobile = normalizeIdentifier(phone);

    // One number, one account.
    //
    // This route checked the e-mail was free and said nothing about the phone,
    // so registering again with a new address minted a SECOND account holding
    // the same number. Sign-in resolves a mobile with findOne, so from then on
    // which account the person reached depended on row order — and the tags
    // they had activated sat on whichever one they did not land on.
    //
    // Unlike the e-mail check below, this one names the problem plainly. The
    // OTP above already proved they control this number, so confirming an
    // account exists on it tells them nothing they have not just demonstrated
    // — and the silent alternative is the duplicate itself.
    const numberTaken = await findOwnerHoldingMobile(collections, verifiedMobile);

    if (numberTaken) {
      reply.code(409);
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error:
          "This mobile number is already on a ParkTag account. Please sign in with it instead — you can add this vehicle from your dashboard."
      };
    }

    const owner = {
      _id: ownerId,
      // Stored canonical so no new mixed-case rows are created. Reads go through
      // findByCanonicalEmail either way, but writing it canonical is what lets
      // that helper's legacy fallback eventually be removed.
      email: canonicalEmail(email),
      passwordHash,
      displayName,
      // Store the OTP-proven number in BOTH fields, canonicalised to +91 form.
      // `mobile` is the OTP-login identity, `phone` is what the contact flow
      // dials. Writing only `phone` (as this route used to) left a dialable
      // number that no login path could match, so signing in later by mobile
      // OTP silently created a SECOND account and split the owner's vehicles
      // and orders across the two.
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
      // Lost the race to the unique index — another registration with this
      // number landed between the check above and this insert. Same answer as
      // the check would have given, rather than a 500.
      if (!isDuplicateMobileError(error)) throw error;
      reply.code(409);
      return {
        ok: false,
        code: "ACCOUNT_EXISTS",
        error:
          "This mobile number is already on a ParkTag account. Please sign in with it instead — you can add this vehicle from your dashboard."
      };
    }

    const tag = await createRegisteredOwnerTag(collections, ownerId, {
      vehicleLabel,
      plateNumber,
      stickerRequested
    });

    const qr = await buildIssuedTagOutput(request, tag);

    return {
      ok: true,
      owner: {
        email,
        displayName
      },
      tag: qr
    };
  });
}
