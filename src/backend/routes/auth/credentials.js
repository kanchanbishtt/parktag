import {
  loginOwnerWithSecret,
  loginUser
} from "../../lib/auth/auth.js";
import { normalizeIdentifier } from "../../lib/auth/otp.js";
import { getClientIp, isNonEmptyString } from "../../lib/auth/security.js";
import { getSprayLock, recordSprayFailure } from "../../lib/auth/spray-lockout.js";
import {
  clearSession,
  createSession,
  getSessionCookieName,
  readSession,
  writeSessionCookie
} from "../../lib/auth/session.js";
import { revokeVaultAccess } from "../../lib/core/vault.js";
import {
  clearLoginFailures,
  getLoginLock,
  recordLoginFailure
} from "../../lib/auth/login-lockout.js";
import { getCollections } from "../../lib/db/repositories.js";

export function registerAuthRoutes(app, env) {
  // Whoami for the current cookie. Returns only what a page needs to render
  // signed-in chrome.
  //
  // It must NEVER return `session.id`. That value IS the wavetag_session cookie,
  // so echoing it handed any script on the page the bearer token the httpOnly
  // flag exists to keep out of reach — one XSS (and the CSP still runs
  // 'unsafe-inline' for both script-src and script-src-attr) turned into a
  // stolen 7-day session replayable from anywhere. `userId` is dropped for the
  // same reason: it is the ObjectId every /api/owner/* route keys off, and no
  // client needs it.
  app.get("/api/session", async (request) => {
    const session = await readSession(app, request);

    if (!session) {
      return { ok: true, session: null };
    }

    return {
      ok: true,
      session: {
        role: session.role,
        email: session.email,
        displayName: session.displayName || null,
        expiresAt: session.expiresAt
      }
    };
  });

  // The role a sign-in authenticates against is fixed by the ROUTE, never by the
  // request body.
  //
  // There used to be a single /api/auth/login whose `role` came from the caller
  // and chose the collection to look in — so the owner login page's own endpoint
  // was equally an admin login endpoint. Anyone could point credential stuffing
  // at the admin table from the public sign-in surface, and the only thing in
  // the way was the per-account lockout. Splitting the routes means an owner
  // endpoint can only ever read `owners`, and reaching admins requires the
  // admin route, which can be firewalled, monitored, or moved independently.
  // Owners sign in with a login PIN or a password, at an e-mail address or a
  // mobile number; admins keep e-mail and password only.
  //
  // ONE secret field for the owner, whichever credential it holds. The obvious
  // alternative — a `pin` endpoint and a `password` endpoint, or a flag saying
  // which is being sent — requires the server to know which credential the
  // account HAS before anyone has authenticated, and every way of acting on
  // that knowledge (a different route, a different error, a different response
  // time) tells an unauthenticated caller whether a given account has a PIN.
  // See loginOwnerWithSecret, which pays for both comparisons every time.
  //
  // Accepting a password here is not a leftover. Owners who registered before
  // PINs existed still have one, and there are accounts with no PIN at all; if
  // this stopped taking passwords they would be locked out of credential
  // sign-in entirely and left waiting on an OTP forever.
  function credentialLogin(role) {
    return async function handler(request, reply) {
      const body = request.body || {};
      const { rememberMe, role: bodyRole } = body;

      // `identifier` and `pin` are the names the current client sends; `email`
      // and `password` are what older clients send and what the admin console
      // still sends. Both spellings, one handler, so a cached page from before
      // this deploy keeps working.
      const rawIdentifier = role === "owner" ? body.identifier ?? body.email : body.email;
      const secret = role === "owner" ? body.pin ?? body.password : body.password;

      // A body role is no longer honoured. Rejecting a contradictory one — as
      // opposed to ignoring it — means a stale client that still sends
      // `role: "admin"` here fails loudly instead of silently attempting an
      // owner sign-in and reporting "Invalid credentials" forever.
      if (bodyRole !== undefined && bodyRole !== role) {
        reply.code(400);
        return {
          ok: false,
          error: "This endpoint does not accept a role. Use the sign-in page for your account type."
        };
      }

      // Typed, not merely truthy. Both values are about to be used as Mongo
      // filter values, and a non-empty array or object is truthy — an untyped
      // check let `{ "identifier": { "$ne": null } }` through to be read as a
      // query operator rather than as a literal.
      if (!isNonEmptyString(rawIdentifier) || !isNonEmptyString(secret)) {
        reply.code(400);
        return {
          ok: false,
          error:
            role === "owner"
              ? "Enter your email or mobile number, and your PIN."
              : "email and password are required"
        };
      }

      // The lockout key is the NORMALISED identifier, so the counter follows
      // the account rather than the spelling. Otherwise "9876543210",
      // "+919876543210" and "09876543210" are three separate budgets against
      // one account, and an attacker resets their allowance by reformatting
      // the number they are already guessing against.
      const identifier = role === "owner" ? normalizeIdentifier(rawIdentifier) : rawIdentifier;

      // Per-ACCOUNT lockout, checked before the password is verified so a locked
      // account costs an attacker a single indexed read rather than a bcrypt
      // comparison. The per-IP rate limit above does not cover this case:
      // credential stuffing arrives from a rotating pool of addresses, which a
      // per-IP counter never sees as one attack.
      //
      // Keyed by role as well as identifier, so owner and admin accounts sharing
      // an address lock independently of one another.
      const collections = await getCollections(env);
      const clientIp = getClientIp(request);

      // Spraying check first, and only for owners — one guess against many
      // accounts, which the per-account counter below is structurally unable to
      // see because no single account ever accumulates enough failures. It
      // matters here specifically because a login PIN is now a valid credential
      // and PINs are drawn from a space small enough to spray. Admin sign-in is
      // a handful of accounts behind a separate route and gains nothing from it.
      if (role === "owner") {
        const spray = await getSprayLock(collections, clientIp);

        if (spray.locked) {
          reply.code(429);
          reply.header("retry-after", String(spray.retryAfterSeconds));
          return {
            ok: false,
            error: "Too many failed sign-in attempts. Please try again later."
          };
        }
      }

      const lock = await getLoginLock(collections, role, identifier);

      if (lock.locked) {
        reply.code(429);
        reply.header("retry-after", String(lock.retryAfterSeconds));
        return {
          ok: false,
          error: "Too many failed sign-in attempts. Please try again later."
        };
      }

      const user =
        role === "owner"
          ? await loginOwnerWithSecret(env, rawIdentifier, secret)
          : await loginUser(env, role, rawIdentifier, secret);

      if (!user) {
        // Recorded against the submitted identifier whether or not an account
        // exists for it, so this stays silent about who has an account. The
        // response is byte-identical to the pre-existing one for the same reason.
        await recordLoginFailure(collections, role, identifier);
        if (role === "owner") await recordSprayFailure(collections, clientIp, identifier);

        reply.code(401);
        return {
          ok: false,
          error: "Invalid credentials"
        };
      }

      await clearLoginFailures(collections, role, identifier);

      // What the drawer and the profile card show as "signed in as". The account
      // e-mail when there is one; otherwise the normalised identifier, which for
      // a phone-only owner is the number they just typed. Falling back to
      // `user.email` alone — as this did while credential sign-in was e-mail
      // only — printed an empty line for every owner who registered by phone.
      const sessionId = await createSession(app, {
        ...user,
        signInIdentifier: user.email || identifier
      });
      writeSessionCookie(reply, sessionId, env.runtimeMode === "production", Boolean(rememberMe));

      return {
        ok: true,
        user
      };
    };
  }

  const loginRateLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

  app.post("/api/auth/login", loginRateLimit, credentialLogin("owner"));
  app.post("/api/auth/admin/login", loginRateLimit, credentialLogin("admin"));

  app.post("/api/auth/logout", async (request, reply) => {
    // Drop any standing vault unlock before the session goes. The grant is
    // keyed by session id, so once the session is deleted nothing can present
    // it — it is inert either way, and never reachable by a recycled id
    // because session ids are 192 bits of randomness and are never reissued.
    // It is removed here so signing out does not leave a row behind that says
    // an unlocked vault exists, which is both untrue and confusing to read in
    // the database.
    const sessionId = request.cookies[getSessionCookieName()];
    if (sessionId) {
      const collections = await getCollections(env);
      if (collections) await revokeVaultAccess(collections, sessionId);
    }

    await clearSession(app, request, reply);

    return {
      ok: true
    };
  });
}
