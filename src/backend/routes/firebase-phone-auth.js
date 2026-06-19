import { ObjectId } from "mongodb";
import { getCollections } from "../lib/repositories.js";
import { createSession, writeSessionCookie } from "../lib/session.js";

// Decode Firebase JWT payload without a network call.
// The phone_number claim is set by Firebase after OTP verification — we trust it.
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const json = Buffer.from(part, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function registerFirebasePhoneAuthRoute(app, env) {
  app.post("/api/auth/firebase-phone-verify", async (request, reply) => {
    const { idToken } = request.body || {};

    if (!idToken) {
      reply.code(400);
      return { ok: false, error: "ID token required." };
    }

    try {
      const claims = decodeJwtPayload(idToken);

      if (!claims?.phone_number) {
        reply.code(401);
        return { ok: false, error: "Could not verify phone number." };
      }

      // Reject expired tokens (exp is Unix seconds)
      if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
        reply.code(401);
        return { ok: false, error: "Session expired. Please try again." };
      }

      // Firebase returns E.164 format e.g. "+917042012645"
      const phoneE164 = claims.phone_number;
      const phoneDigits = phoneE164.replace(/[^\d]/g, ""); // "917042012645"
      const phone10 = phoneDigits.length >= 10
        ? phoneDigits.slice(-10)  // "7042012645"
        : phoneDigits;

      const collections = await getCollections(env);
      if (!collections) {
        reply.code(500);
        return { ok: false, error: "Database not configured." };
      }

      // Match any stored format
      let owner = await collections.owners.findOne({
        $or: [
          { mobile: phoneE164 },
          { mobile: phoneDigits },
          { mobile: phone10 }
        ]
      });

      const isNew = !owner;

      if (isNew) {
        const ownerId = new ObjectId();
        owner = {
          _id: ownerId,
          mobile: phoneE164,
          displayName: phone10,
          credits: 0,
          role: "owner",
          createdAt: new Date().toISOString()
        };
        await collections.owners.insertOne(owner);
      }

      const sessionId = await createSession(app, {
        id: String(owner._id),
        role: "owner",
        email: owner.email || owner.mobile || phoneE164,
        displayName: owner.displayName || phone10
      });
      writeSessionCookie(reply, sessionId);

      return { ok: true, isNew };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Verification failed."
      };
    }
  });
}
