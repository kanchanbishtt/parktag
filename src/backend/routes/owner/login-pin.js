import { requireSession, toObjectId } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import {
  getSessionCookieName,
  revokeOtherSessionsForUser
} from "../../lib/auth/session.js";
import { verifyPassword } from "../../lib/auth/security.js";
import {
  clearStoredLoginPin,
  hasLoginPin,
  isValidLoginPin,
  isWeakLoginPin,
  loginPinRequirementMessage,
  setLoginPin,
  verifyLoginPinForChange,
  weakLoginPinMessage
} from "../../lib/auth/login-pin.js";

// ── Login PIN management ───────────────────────────────────────────────────
//
// Everything here is behind an owner session AND the app-wide CSRF origin check
// in app.js (which covers every state-changing /api/owner/* call). A session
// alone is not enough for a credential change: without the origin check, any
// page the owner happens to have open could POST a PIN of its choosing into
// their account and keep it after the session expired.
//
// The rate limits are per route rather than shared. Reading the status is
// harmless and generous; setting a PIN is slow, bcrypt-bound work and does not
// need to be fast; and every path that verifies a CURRENT pin also carries the
// per-account lockout inside verifyLoginPinForChange, because a rate limit
// keyed on IP is not a brute-force control on its own.
export function registerLoginPinRoutes(app, env) {
  async function ownerContext(request, reply) {
    const blocked = await requireSession(app, "owner")(request, reply);
    if (blocked) return { blocked };

    const collections = await getCollections(env);
    if (!collections) {
      reply.code(500);
      return { blocked: { ok: false, error: "Database not configured." } };
    }

    return { collections, ownerId: toObjectId(request.session.userId) };
  }

  // Whether a PIN exists, and when it was set. Never the PIN, never the hash.
  app.get(
    "/api/owner/login-pin",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const ctx = await ownerContext(request, reply);
      if (ctx.blocked) return ctx.blocked;

      const status = await hasLoginPin(ctx.collections, ctx.ownerId);
      return { ok: true, ...status };
    }
  );

  // Set a PIN, or change one that already exists.
  app.post(
    "/api/owner/login-pin",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const ctx = await ownerContext(request, reply);
      if (ctx.blocked) return ctx.blocked;

      const { collections, ownerId } = ctx;
      const { pin, confirmPin, currentPin } = request.body || {};

      if (!isValidLoginPin(pin)) {
        reply.code(400);
        return { ok: false, error: loginPinRequirementMessage() };
      }

      // Checked server-side as well as in the form. The browser comparison is a
      // convenience; this is the one that decides, because a mismatched pair
      // that reached the database would set a credential the owner has never
      // typed and cannot guess — a self-inflicted lockout with no way back.
      if (String(pin) !== String(confirmPin || "")) {
        reply.code(400);
        return { ok: false, error: "The two PINs do not match." };
      }

      // Read once, for the weak-PIN screen (which needs the phone number to
      // reject a PIN cut out of it) and for the vault-PIN comparison below.
      const owner = await collections.owners.findOne(
        { _id: ownerId },
        { projection: { mobile: 1, phone: 1, vaultPinHash: 1 } }
      );

      if (isWeakLoginPin(pin, owner)) {
        reply.code(400);
        return { ok: false, error: weakLoginPinMessage() };
      }

      // The vault PIN is a SECOND factor over a session that is already signed
      // in. Reusing it as the login PIN would collapse the two into one secret,
      // so learning the PIN that gets you in would also open the documents and
      // the vault would stop being a second factor at all. Cheap to check here
      // — the owner is authenticated and already knows both values, so this
      // tells them nothing they did not have.
      if (owner && owner.vaultPinHash) {
        const clash = await verifyPassword(String(pin), owner.vaultPinHash);
        if (clash.valid) {
          reply.code(400);
          return {
            ok: false,
            error: "Choose a different PIN from your document vault PIN — they protect different things."
          };
        }
      }

      const existing = await hasLoginPin(collections, ownerId);

      if (existing.hasPin) {
        const check = await verifyLoginPinForChange(collections, ownerId, currentPin);

        if (check.locked) {
          reply.code(429);
          reply.header("retry-after", String(check.retryAfterSeconds));
          return {
            ok: false,
            error: "Too many incorrect PIN attempts. Try again later.",
            retryAfterSeconds: check.retryAfterSeconds
          };
        }

        if (!check.ok) {
          reply.code(400);
          return { ok: false, error: "Current PIN is incorrect." };
        }
      }

      await setLoginPin(collections, ownerId, pin);

      // A new credential must not leave old sessions standing. If this change
      // was made by someone holding a stolen cookie, every other session they
      // have dies with it and the real owner is signed out on their other
      // devices — which is how they find out, immediately, rather than months
      // later. The session making the change is kept, so the owner is not
      // ejected from the screen they are looking at.
      const revoked = await revokeOtherSessionsForUser(
        app,
        request.session.userId,
        request.cookies[getSessionCookieName()]
      );

      return { ok: true, hasPin: true, changed: existing.hasPin, signedOutElsewhere: revoked };
    }
  );

  // Remove the PIN. Still requires the current one: a stolen session must not
  // be able to strip a credential off the account, and "forgot it" is served by
  // the OTP sign-in that every account already has, not by deleting the PIN.
  app.delete(
    "/api/owner/login-pin",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const ctx = await ownerContext(request, reply);
      if (ctx.blocked) return ctx.blocked;

      const { collections, ownerId } = ctx;
      const existing = await hasLoginPin(collections, ownerId);

      // Idempotent: nothing to remove is a success, not an error to explain.
      if (!existing.hasPin) return { ok: true, hasPin: false };

      const check = await verifyLoginPinForChange(
        collections,
        ownerId,
        (request.body || {}).currentPin
      );

      if (check.locked) {
        reply.code(429);
        reply.header("retry-after", String(check.retryAfterSeconds));
        return {
          ok: false,
          error: "Too many incorrect PIN attempts. Try again later.",
          retryAfterSeconds: check.retryAfterSeconds
        };
      }

      if (!check.ok) {
        reply.code(400);
        return { ok: false, error: "Current PIN is incorrect." };
      }

      await clearStoredLoginPin(collections, ownerId);
      return { ok: true, hasPin: false };
    }
  );

  // "Logout from all devices" — every session except the one asking.
  //
  // Keeping the caller's session is the point. Signing yourself out along with
  // the borrowed laptop would make the button useless for the thing people
  // actually reach for it: they have just realised they left themselves logged
  // in somewhere, and they want that ended from here, now.
  app.post(
    "/api/owner/sessions/revoke-others",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (request, reply) => {
      const blocked = await requireSession(app, "owner")(request, reply);
      if (blocked) return blocked;

      const revoked = await revokeOtherSessionsForUser(
        app,
        request.session.userId,
        request.cookies[getSessionCookieName()]
      );

      return { ok: true, revoked };
    }
  );
}
