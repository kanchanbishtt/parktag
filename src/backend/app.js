import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

import { getEnv } from "./lib/env.js";
import { renderAnalyticsBundle } from "./lib/analytics.js";
import { BoundedTtlMap } from "./lib/bounded-map.js";
import { clientError, clientErrorMessage } from "./lib/errors.js";
import { readSession } from "./lib/auth/session.js";
import { createSharedRateLimitStore } from "./lib/auth/rate-limit-store.js";
import { getCollections } from "./lib/db/repositories.js";
import { stickerSerialFor } from "./lib/core/tag-issuance.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAdminTrafficRoutes } from "./routes/admin/traffic.js";
import { registerAdminMarketingRoutes } from "./routes/admin/marketing.js";
import { registerAuthRoutes } from "./routes/auth/credentials.js";
import { registerAnalyticsRoutes } from "./routes/system/analytics.js";
import { registerDemoRoutes } from "./routes/system/demo.js";
import { registerOwnerRoutes } from "./routes/owner/dashboard.js";
import { registerVaultRoutes } from "./routes/owner/vault.js";
import { registerLoginPinRoutes } from "./routes/owner/login-pin.js";
import { registerMembershipRoutes } from "./routes/owner/membership.js";
import { MAX_FILE_BYTES } from "./lib/core/vault.js";
import { cacheControlFor, resolveAssetVersion } from "./lib/core/asset-version.js";
import { registerProviderRoutes } from "./routes/webhooks/exotel.js";
import { registerMetaWebhookRoutes } from "./routes/webhooks/meta.js";
import { registerRazorpayWebhookRoutes } from "./routes/webhooks/razorpay.js";
import { registerPublicRoutes } from "./routes/public/index.js";
import { registerRegistrationRoutes } from "./routes/owner/registration.js";
import { registerOtpAuthRoutes } from "./routes/auth/otp.js";
import { registerGoogleAuthRoutes } from "./routes/auth/google.js";
import { registerFirebasePhoneAuthRoute } from "./routes/auth/firebase.js";
import { registerPasswordResetRoutes } from "./routes/auth/password-reset.js";
import { registerRuntimeRoutes } from "./routes/system/runtime.js";
import { registerReviewerSetupRoute } from "./routes/system/reviewer-setup.js";
import { registerShopRoutes } from "./routes/shop/index.js";
// Used by /shop to check that a pack id arriving from the public storefront is
// a real product before it is carried into a redirect.
import { getShopProduct } from "./lib/integrations/payments.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const frontendRoot = path.resolve(currentDir, "../frontend");
const pagesRoot = path.join(frontendRoot, "pages");
// Deliberately under src/backend, NOT src/frontend: this file carries
// placeholders that are filled from env per request, and anything under
// frontendRoot is also reachable raw through fastifyStatic.
const analyticsAsset = path.join(currentDir, "assets/analytics.js");
const scannerPage = path.join(pagesRoot, "scanner/index.html");
const verifyPage = path.join(pagesRoot, "scanner/verify.html");
const trackOrderPage = path.join(pagesRoot, "scanner/track-order.html");
const reportTagPage = path.join(pagesRoot, "scanner/report-tag.html");
const adminPage = path.join(pagesRoot, "admin/index.html");
const adminMarketingPage = path.join(pagesRoot, "admin/marketing.html");
const adminOverviewPage = path.join(pagesRoot, "admin/overview.html");
const adminTrafficPage = path.join(pagesRoot, "admin/traffic.html");
const adminEtagsPage = path.join(pagesRoot, "admin/etags.html");
const adminActivationsPage = path.join(pagesRoot, "admin/activations.html");
const adminIssuancePage = path.join(pagesRoot, "admin/issuance.html");
const adminPrintQueuePage = path.join(pagesRoot, "admin/print-queue.html");
const adminOwnersPage = path.join(pagesRoot, "admin/owners.html");
const adminActivityPage = path.join(pagesRoot, "admin/activity.html");
const adminAdminsPage = path.join(pagesRoot, "admin/admins.html");
const stickerPrintPage = path.join(pagesRoot, "admin/sticker-print.html");
const registerOwnerPage = path.join(pagesRoot, "owner/register.html");
const ownerLoginPage = path.join(pagesRoot, "owner/login.html");
const hubPage = path.join(pagesRoot, "hub.html");
const shopPage = path.join(pagesRoot, "shop.html");
const getPage = path.join(pagesRoot, "get.html");
const forgotPasswordPage = path.join(pagesRoot, "owner/forgot-password.html");
const resetPasswordPage = path.join(pagesRoot, "owner/reset-password.html");
const ownerVerifyPage = path.join(pagesRoot, "owner/verify.html");
const ownerWelcomePage = path.join(pagesRoot, "owner/welcome.html");
const ownerVehicleDetailPage = path.join(pagesRoot, "owner/vehicle-detail.html");
const ownerDocumentsPage = path.join(pagesRoot, "owner/documents.html");
const ownerLoginPinPage = path.join(pagesRoot, "owner/login-pin.html");
const ownerMembershipPage = path.join(pagesRoot, "owner/membership.html");
// The token every page writes into its stylesheet and script URLs. It is
// replaced on the way out (see the onSend hook) with a digest of the asset tree,
// so the URL changes whenever the bytes do and a returning visitor can never be
// left holding a stale script. This replaced two hand-bumped constants
// ("parktag-ui-10", "hub-shell-1") that covered only the scanner and hub pages
// and relied on somebody remembering to change them.
const ASSET_VERSION_TOKEN = "__ASSET_VERSION__";

// Every request is logged with its URL, and several sensitive values travel in
// the query string: the Exotel webhook secret (?token=), the inbound caller's
// phone (?CallFrom=), the Meta verify token (?hub.verify_token=), the
// password-reset token (?token=), and the OAuth auth code (?code=). Redact the
// VALUE of any query param whose name looks sensitive before it reaches the
// logs, keeping the rest of the URL intact for debugging. Matches on the
// param name only, so it never has to parse the (secret) value itself.
const SENSITIVE_QS_SUBSTRING = /(token|secret|password|passwd|otp|phone|mobile|signature|api[_-]?key)/i;
const SENSITIVE_QS_EXACT = new Set(["code", "state", "callfrom", "caller", "callto", "callerid"]);

function isSensitiveQueryKey(key) {
  const k = String(key);
  return SENSITIVE_QS_SUBSTRING.test(k) || SENSITIVE_QS_EXACT.has(k.toLowerCase());
}

function sanitizeLogUrl(url) {
  if (typeof url !== "string") return url;
  const q = url.indexOf("?");
  if (q === -1) return url;
  const path = url.slice(0, q);
  const query = url.slice(q + 1);
  const sanitized = query.replace(
    /([^&=?#]+)=([^&#]*)/g,
    (match, key) => (isSensitiveQueryKey(key) ? `${key}=[REDACTED]` : match)
  );
  return `${path}?${sanitized}`;
}

// Pages that either take credentials or render a signed-in view. None of them
// may be kept by a shared cache or replayed out of the browser's back/forward
// store: on a shared or borrowed device, tapping Back after signing out
// otherwise re-renders the previous occupant's page from history.
//
// `no-store` is the directive that governs the history store; `no-cache` alone
// permits it. The rest are there for intermediaries that predate `no-store`.
//
// Applied by a hook rather than by editing each handler, so a page added later
// is covered by adding one line here instead of by remembering to repeat a call
// at the bottom of a new route.
const NO_STORE_PAGES = new Set([
  "/owner-login",
  "/owner-verify",
  "/owner-welcome",
  "/owner-documents",
  "/owner-login-pin",
  "/owner-membership",
  "/owner",
  "/register-owner",
  "/forgot-password",
  "/reset-password"
]);

// Pages served with no 'unsafe-inline' in script-src, and with inline event
// handler attributes refused outright.
//
// The app-wide policy has to keep both, because the owner dashboard and the
// admin console build markup with onclick="..." in it — eight sites in the
// admin bundle alone — and those break the moment script-src-attr is tightened.
// Removing that pattern everywhere is a real refactor, and not one to attach to
// a security fix.
//
// These five pages need neither. None contains an inline <script> (the two that
// did now load their code from a file), and none of the scripts they run emits
// an inline handler. So the pages that actually take credentials get the strict
// policy today, and the rest keep the permissive one until the refactor happens.
//
// NOT the same list as NO_STORE_PAGES: /owner-welcome and /admin must not be
// cached either, but both generate inline handlers and would break here.
// Pages that take a payment AND carry no inline script or handlers.
//
// /owner-membership was on STRICT_SCRIPT_PAGES, which is where it belonged
// until it sold something: that list replaces script-src with
// STRICT_SCRIPT_SOURCES, and Razorpay's checkout.js is not in it, so the
// checkout would simply never load. Adding checkout.razorpay.com to
// STRICT_SCRIPT_SOURCES instead would put a payment origin on the login and
// password-reset pages, which take no payments and have no business loading it.
//
// So this is its own policy, and it is STRICTER than the one /owner-welcome
// gets: same Razorpay-capable script-src, but script-src-attr stays 'none',
// because unlike the dashboard this page builds nothing with onclick.
//
// style-src keeps 'unsafe-inline', which the strict list removes. That is not
// laziness — checkout.js injects a <style> element for its overlay, and
// blocking it leaves the payment sheet rendering wrong. The same reason
// /owner-welcome keeps it.
const PAYMENT_STRICT_PAGES = new Set(["/owner-membership"]);

const STRICT_SCRIPT_PAGES = new Set([
  "/owner-login",
  "/owner-login-pin",
  "/owner-verify",
  "/register-owner",
  "/forgot-password",
  "/reset-password"
]);

// The checkout page: no inline <script>, but plenty of inline onclick.
//
// /owner-welcome is where money changes hands, and it was running on the
// app-wide policy — script-src with 'unsafe-inline', which is the one directive
// standing between an injected <script> and it executing. It could not join the
// list above because its whole shop half lived in an inline <script> at the
// bottom of the page, and because fifty-odd controls are wired with onclick
// attributes.
//
// The first of those is now fixed: that block is /scripts/owner/welcome-shop.js,
// so script-src can drop 'unsafe-inline' here and an injected <script> element
// no longer runs. The second is not, so script-src-attr keeps 'unsafe-inline' —
// injecting into an attribute context still works, which is a narrower hole than
// the one being closed but is not nothing. Converting those handlers is a real
// refactor of a live checkout and belongs in its own change.
//
// style-src is left alone as well: the page opens with an inline <style> block
// and stripping it would take the layout with it.
const NO_INLINE_SCRIPT_PAGES = new Set(["/owner-welcome"]);

// Script origins the checkout page actually loads. Not the app-wide list: it
// needs Razorpay's checkout.js, and nothing else third-party — no Google
// sign-in, no reCAPTCHA.
//
// checkout.js also tries to pull a risk-detection bundle from cdn.razorpay.com,
// which the app-wide policy already blocks today and this does not change. It is
// wrapped in a try/catch and loaded async at their end, so checkout works
// without it; allowing that origin is a decision about Razorpay's fraud signals,
// not something to slip into a CSP tightening.
//
// The analytics loaders are here because /owner-welcome is where the entire
// commerce funnel reports from: view_item, begin_checkout, purchase and
// sign_up all fire on this page. Tightening script-src to Razorpay alone left
// the single most valuable page in the app unable to load either tracker, so
// the conversions the Pixel exists to optimise on would never have been sent.
// This page is data-surface="app", so unlike the credential pages it gets both.
const CHECKOUT_SCRIPT_SOURCES =
  "'self' https://checkout.razorpay.com https://www.googletagmanager.com https://connect.facebook.net";

// Derived from whatever helmet just set, rather than written out again, so a
// change to the app-wide policy carries over instead of leaving these pages on
// a stale copy of it.
// Script origins these pages actually load. The app-wide list also carries
// accounts.google.com, checkout.razorpay.com and the reCAPTCHA hosts, because
// somewhere in the app signs in with Google and takes payments — but not here.
// Google sign-in was removed from the owner login page, and nothing on a
// credential page reaches Razorpay, so allowing those origins only widened what
// an injection on these particular pages could pull in.
//
// www.google.com and www.gstatic.com stay: they serve the reCAPTCHA loader,
// which the OTP-send flow uses when RECAPTCHA_SITE_KEY is configured.
//
// Both analytics loaders are here. Meta is given the same view of the funnel
// as GA4, on the reasoning that signal Meta never receives is money spent
// finding worse customers — every CTA on the marketing site lands on
// /owner-login, so a tracker that cannot see this page cannot see the biggest
// drop-off in the funnel.
//
// What makes that safe on a page with a password box is a setting rather than
// a policy: "Track events automatically without code" must stay OFF in Events
// Manager. That is the feature that lets the Pixel read form fields on its
// own. With it off the Pixel sends only what ptTrack hands it, and everything
// handed to it passes the ALLOWED list in assets/analytics.js first. If that
// setting is ever turned on, connect.facebook.net should come back out of this
// list the same day.
const STRICT_SCRIPT_SOURCES =
  "'self' https://www.google.com https://www.gstatic.com " +
  "https://www.googletagmanager.com https://connect.facebook.net";

// Inline styles are a separate question from inline script and are not solved
// here. These pages still carry `style="..."` attributes throughout their
// markup, and stripping every one is a layout refactor. Blocking a whole
// injected <style> element is still worth having, so style-src loses
// 'unsafe-inline' while style-src-attr keeps it — the attributes that exist
// keep working, a `<style>` an attacker injects does not.
function tightenScriptDirectives(policy) {
  const directives = String(policy)
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean);

  const out = directives.map((directive) => {
    if (directive.startsWith("script-src-attr")) return "script-src-attr 'none'";
    if (directive.startsWith("script-src ")) return `script-src ${STRICT_SCRIPT_SOURCES}`;
    if (directive.startsWith("style-src ")) {
      return directive.replace(/\s*'unsafe-inline'/g, "");
    }
    return directive;
  });

  // helmet emits no style-src-attr of its own, so without adding one here the
  // tightened style-src would cascade to attributes and break the pages.
  if (!out.some((d) => d.startsWith("style-src-attr"))) {
    out.push("style-src-attr 'unsafe-inline'");
  }

  return out.join(";");
}

// script-src only. Unlike tightenScriptDirectives above this leaves
// script-src-attr and style-src exactly as helmet set them — the page needs both
// — so the only thing it takes away is the ability to run an inline <script>.
function tightenScriptSrcOnly(policy) {
  return String(policy)
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) =>
      directive.startsWith("script-src ") ? `script-src ${CHECKOUT_SCRIPT_SOURCES}` : directive
    )
    .join(";");
}

// Razorpay's checkout.js allowed, inline handlers refused, inline styles left
// alone. See PAYMENT_STRICT_PAGES for why each of those three is the way it is.
function tightenForPaymentPage(policy) {
  return String(policy)
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      if (directive.startsWith("script-src-attr")) return "script-src-attr 'none'";
      if (directive.startsWith("script-src ")) return `script-src ${CHECKOUT_SCRIPT_SOURCES}`;
      return directive;
    })
    .join(";");
}

function isNoStorePage(pathname) {
  // Every /admin page is an authenticated view, including the sub-pages.
  return NO_STORE_PAGES.has(pathname) || pathname === "/admin" || pathname.startsWith("/admin/");
}

function setNoStore(reply) {
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

function setScannerNoCache(reply) {
  reply.header(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
}

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logger: {
      // Redact sensitive query-string values (webhook secret, caller phone,
      // verify/reset tokens, OAuth code) from the URL in every request log.
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: sanitizeLogUrl(request.url),
            hostname: request.hostname,
            remoteAddress: request.ip,
            remotePort: request.socket ? request.socket.remotePort : undefined
          };
        }
      }
    },
    // The app runs behind a single reverse proxy hop in every real deployment
    // (Render's edge network, and any other PaaS/CDN in front of it). Without
    // this, Fastify's `request.ip` is the proxy's own socket address — the
    // SAME value for every visitor — so every IP-keyed rate limit
    // (@fastify/rate-limit's default key generator uses `request.ip`)
    // collapses into one shared, site-wide bucket. A single attacker sending
    // 5 junk POSTs to /api/auth/login (or /send-otp, /register-owner,
    // /forgot-password, etc.) would exhaust that bucket and lock the
    // corresponding action out for every real visitor for the rest of the
    // window — a trivial, cheap denial-of-service against a payments app.
    // Parsing `X-Forwarded-For` populates `request.ip` with the real client IP
    // instead, restoring per-visitor rate limiting.
    //
    // Use `1` (trust exactly one proxy hop), NOT `true`. `true` trusts the
    // ENTIRE forwarded chain, so an attacker can prepend a spoofed
    // `X-Forwarded-For` and get a brand-new `request.ip` — hence a fresh
    // rate-limit bucket — on every request, defeating the 5/min login/OTP
    // limits and the plate last-4 lockout. `1` trusts only the single reverse
    // proxy actually in front of the app (Railway's edge), so `request.ip` is
    // the IP that proxy observed and any client-supplied XFF entries are
    // ignored. If the deployment ever gains another proxy hop (e.g. a CDN in
    // front of Railway), bump this to match the real number of trusted hops.
    // ONE hop, expressed as a predicate rather than the number 1.
    //
    // `trustProxy: 1` meant this and read better, but fastify 5.12.3 — the
    // release that fixes GHSA-3m5p-2c4r-xxw2, the X-Forwarded-* spoof this
    // setting exists to prevent — changed what a NUMBER means. On that version
    // `1` stops trusting the proxy at all: request.ip becomes the address of
    // Railway's edge for every caller and request.protocol falls back to
    // "http". That is worse than the bug being fixed. Every per-IP limit
    // collapses into a single shared bucket, so one abuser rate-limits the
    // entire userbase, and the spray lockout keys on one address for everyone.
    //
    // The predicate form is unchanged by the patch and says exactly what was
    // meant: the immediate peer (hop 0) is our reverse proxy and nothing beyond
    // it is trusted. `true` also restores the client IP but trusts the WHOLE
    // chain, which hands the spoof straight back — a caller who prepends
    // "X-Forwarded-For: 1.2.3.4" is believed. Verified against a real socket on
    // both versions: with `1.2.3.4, <real client>` this yields the real client,
    // while `true` yields 1.2.3.4.
    //
    // Address-agnostic on purpose. An allowlist ("loopback", a subnet) works
    // too, but only while Railway's edge keeps the address we wrote down.
    //
    // If the deployment ever gains another proxy hop (a CDN in front of
    // Railway), widen this to `hop <= 1` and so on to match the real count.
    trustProxy: (_address, hop) => hop === 0
  });

  // Hashed once at boot rather than per request: the asset tree cannot change
  // under a running process, and every HTML response substitutes this.
  const assetVersion = await resolveAssetVersion(frontendRoot, app.log);
  app.log.info({ event: "asset-version", assetVersion }, "[assets] versioned URLs stamped");

  // In-process cache in front of the MongoDB-backed session store (see
  // lib/auth/session.js). Sessions themselves live in Mongo, so a restart or a
  // second instance no longer logs users out — this is just a fast path.
  //
  // BOUNDED (see lib/bounded-map.js): a plain Map only ever evicted a session
  // when someone read it AFTER it had expired, so sessions belonging to users
  // who never came back were retained for the life of the process. Dropping an
  // entry early is free here — a cached session is only trusted for
  // CACHE_REVALIDATE_MS (30s) before it is re-read from Mongo anyway, so an
  // eviction costs one extra query and nothing else.
  app.decorate("sessions", new BoundedTtlMap({
    ttlMs: 60 * 60 * 1000, // 1 hour — far beyond the 30s the cache is trusted for
    cap: 10000,
    name: "sessions"
  }));

  // Server-side OAuth state store — avoids SameSite cookie blocking on the
  // Google callback.
  //
  // BOUNDED, and this one was the leak that mattered: an entry is written by
  // GET /api/auth/google (unauthenticated) and deleted only by the CALLBACK, so
  // every abandoned sign-in leaked permanently and the route could be called in
  // a loop. TTL matches STATE_TTL_MS in routes/auth/google.js — a state older
  // than that is refused there anyway, so expiring it here drops nothing that
  // could still have been used. Mongo keeps the authoritative copy (TTL index
  // on oauth_states), so an eviction under load degrades to a DB read.
  app.decorate("oauthStates", new BoundedTtlMap({
    ttlMs: 10 * 60 * 1000,
    cap: 5000,
    name: "oauthStates"
  }));

  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (request, body, done) => {
      const params = new URLSearchParams(body);
      const data = Object.fromEntries(params.entries());
      done(null, data);
    }
  );

  // Custom JSON parser that also stashes the raw request bytes on
  // `request.rawBody`. Needed to verify Meta's `X-Hub-Signature-256` webhook
  // header, which is an HMAC over the exact raw payload — recomputing it from
  // the re-serialized/parsed JSON body would not reliably match.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      request.rawBody = body;
      if (!body || body.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (err) {
        err.statusCode = 400;
        done(err, undefined);
      }
    }
  );

  await app.register(fastifyCookie);

  // See NO_STORE_PAGES. Set on the way out so it covers every response from
  // these paths — the rendered page, and the redirect an unauthenticated
  // visitor gets instead of it.
  // Cross-site request forgery guard for the credential endpoints.
  //
  // SameSite=Lax on the session cookie already stops a cross-site POST carrying
  // a session, so this is the second line rather than the first — but it covers
  // what SameSite does not. Sign-in is the case: a forged POST to
  // /api/auth/login carries no cookie and does not need one, because it is
  // creating the session. Land one on a victim's browser and they are quietly
  // signed in as the attacker, and everything they do next — an address, a
  // vehicle, a document — is filed under the attacker's account.
  //
  // Origin is the check. A browser attaches it to every cross-origin POST and
  // scripts cannot forge it. Referer is the fallback for the rare browser that
  // omits Origin on same-origin requests.
  //
  // Neither header present means the caller is not a browser — curl, the verify
  // scripts, a server-to-server call — and is allowed through: those requests
  // are not the ones an attacker can make a victim's browser send. Blocking
  // them would break the operational scripts while stopping no attack.
  //
  // WHAT IS COVERED. Every prefix below is a browser-driven surface whose
  // requests are authorised by a cookie, which is precisely the shape a forged
  // cross-site request exploits. It started at /api/auth/* alone, which left
  // every signed-in action — change a tag's status, rewrite an emergency
  // contact, delete a vehicle, delete the account — with no origin check at
  // all. SameSite=Lax covers most of that in a current browser by withholding
  // the cookie, but Lax is same-SITE: a foothold on any parktag.me subdomain
  // is same-site and keeps the cookie. This is the control that does not have
  // that gap.
  //
  // WHAT IS NOT, and must not be. The Exotel and Meta webhooks under
  // /api/provider/* are cross-origin POSTs by design and authenticate with
  // their own secrets, so an origin check would reject every one of them. The
  // public scan, shop and contact surfaces are left out for the same reason —
  // they are reachable without a session, so there is no ambient authority to
  // forge, and a payment provider may post to them from its own origin.
  //
  // Unsafe methods only. GET is excluded because it is not supposed to change
  // state, and sweeping it in would block ordinary cross-site navigation.
  // /api/shop/ was left out when this list was widened, on the assumption that a
  // payment provider might post to it. It does not: there is no Razorpay webhook
  // route in this app, and every /api/shop/* route is a fetch from our own
  // checkout. That left the money routes — place a COD order, start a payment,
  // confirm one — as the only signed-in surface with no origin check at all.
  const CSRF_PROTECTED_PREFIXES = ["/api/auth/", "/api/owner/", "/api/admin/", "/api/shop/"];
  const CSRF_PROTECTED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  // Both sides of the comparison go through the URL parser. Comparing a parsed
  // origin against a concatenated string does not work: the parser drops a
  // default port, so a browser's "http://localhost" never equals a hand-built
  // "http://localhost:80" and the site rejects its own sign-in page.
  function toOrigin(value) {
    try {
      return new URL(value).origin;
    } catch {
      return null;
    }
  }

  const allowedOrigins = new Set([toOrigin(env.appBaseUrl)].filter(Boolean));

  app.addHook("onRequest", async (request, reply) => {
    if (!CSRF_PROTECTED_METHODS.has(request.method)) return;
    if (!CSRF_PROTECTED_PREFIXES.some((prefix) => request.url.startsWith(prefix))) return;

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    if (!origin && !referer) return;

    const source = toOrigin(origin || referer);

    if (!source) {
      reply.code(403);
      return reply.send({ ok: false, error: "Request blocked: malformed origin." });
    }

    // APP_BASE_URL is the trusted reference. The Host the request arrived on is
    // accepted as well, so a preview domain or a second hostname pointing at
    // this service is not locked out of its own sign-in page.
    //
    // Host is caller-supplied, which looks like a hole and is not one for the
    // attack this defends: in a cross-site POST the victim's browser sets Host
    // to the site it is posting to and Origin to the attacker's page, so the two
    // cannot be made to agree. It is logged when it is what allowed a request
    // through and it disagrees with APP_BASE_URL, because that combination
    // usually means APP_BASE_URL is set wrong rather than that anything is being
    // attacked — and a wrong APP_BASE_URL is otherwise invisible until the day
    // this fallback is removed.
    const selfOrigin = toOrigin(`${request.protocol}://${request.headers.host}`);
    const matchesConfigured = allowedOrigins.has(source);

    if (!matchesConfigured && source === selfOrigin) {
      request.log.warn(
        { event: "csrf-host-fallback", source, configured: [...allowedOrigins] },
        "[csrf] request allowed by its Host header, not by APP_BASE_URL — check APP_BASE_URL"
      );
    }

    if (source !== selfOrigin && !matchesConfigured) {
      request.log.warn(
        { event: "csrf-origin-rejected", source, method: request.method, path: request.url },
        "[csrf] cross-origin state-changing request to a cookie-authenticated endpoint was refused"
      );
      reply.code(403);
      return reply.send({
        ok: false,
        error: "Request blocked: this request did not come from the ParkTag site."
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const pathname = request.url.split("?")[0];

    if (isNoStorePage(pathname)) {
      setNoStore(reply);
    }

    if (PAYMENT_STRICT_PAGES.has(pathname)) {
      const policy = reply.getHeader("content-security-policy");
      if (policy) {
        reply.header("content-security-policy", tightenForPaymentPage(policy));
      }
    } else if (STRICT_SCRIPT_PAGES.has(pathname)) {
      const policy = reply.getHeader("content-security-policy");
      if (policy) {
        reply.header("content-security-policy", tightenScriptDirectives(policy));
      }
    } else if (NO_INLINE_SCRIPT_PAGES.has(pathname)) {
      const policy = reply.getHeader("content-security-policy");
      if (policy) {
        reply.header("content-security-policy", tightenScriptSrcOnly(policy));
      }
    }

    const isHtml = String(reply.getHeader("content-type") || "").startsWith("text/html");
    if (!isHtml) return payload;

    // A page carries the asset stamp, and the URLs it stamps are cached for a
    // year — so the page itself must never be the stale part. Only set this
    // when the route has not already made a stronger choice: the signed-in and
    // scanner pages send no-store, which additionally keeps them out of the
    // back/forward store, and must not be softened to no-cache here.
    if (!reply.getHeader("cache-control")) {
      reply.header("Cache-Control", "no-cache");
    }

    // One substitution for every page, instead of a replaceAll remembered at
    // the bottom of each route. Pages read straight off disk by the static
    // handler arrive here as a stream and keep the literal token, which is
    // harmless: an unmatched stamp is refused immutability and revalidated.
    return typeof payload === "string"
      ? payload.replaceAll(ASSET_VERSION_TOKEN, assetVersion)
      : payload;
  });

  const isProduction = env.runtimeMode === "production";

  await app.register(fastifyHelmet, {
    // Pages use inline <script>/<style> blocks (no nonce infrastructure yet),
    // so 'unsafe-inline' stays on for now — but every other directive is
    // locked down to the known first/third-party origins the app actually
    // uses. This still blocks arbitrary third-party script/asset injection,
    // clickjacking via unexpected frames, and stray form-action exfiltration.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://accounts.google.com",
          "https://checkout.razorpay.com",
          // Google reCAPTCHA v3 loader + its runtime assets (invisible bot check
          // on the OTP-send flow). Inert unless RECAPTCHA_SITE_KEY is set.
          "https://www.google.com",
          "https://www.gstatic.com",
          // GA4 and the Meta Pixel fetch their runtime from these two.
          //
          // Without them the browser blocks both loaders outright, which is a
          // failure with no symptom on this side: /pt-analytics.js is served
          // correctly, the IDs are right, and every dashboard stays empty. The
          // policy has to be widened in step with the code it protects.
          "https://www.googletagmanager.com",
          "https://connect.facebook.net"
        ],
        // The owner/admin pages wire controls with inline onclick handlers.
        // Helmet defaults script-src-attr to 'none', which blocks ALL inline
        // event handlers — breaking the hamburger menu, Shop/Tags tabs,
        // "Continue with Google", Buy Now, etc. Allow inline handlers so those
        // controls work. (scriptSrc's 'unsafe-inline' does NOT cover event
        // handler attributes — script-src-attr is a separate directive.)
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        // Both trackers still deliver some hits as image beacons, which
        // img-src governs rather than connect-src.
        imgSrc: [
          "'self'",
          "data:",
          "https://api.qrserver.com",
          "https://*.google-analytics.com",
          "https://*.googletagmanager.com",
          "https://www.facebook.com"
        ],
        // Where the trackers actually POST. Blocking these is subtler than
        // blocking the loaders: the scripts run, ptTrack() reports success, and
        // the events die at the network boundary.
        connectSrc: [
          "'self'",
          "https://www.google.com",
          "https://*.google-analytics.com",
          "https://*.analytics.google.com",
          "https://*.googletagmanager.com",
          "https://www.facebook.com",
          "https://connect.facebook.net"
        ],
        frameSrc: ["https://accounts.google.com", "https://*.razorpay.com", "https://www.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        // 'self' alone renders a blank frame in VS Code's Simple Browser: the
        // page is embedded in a cross-origin webview iframe (vscode-webview://
        // on desktop, *.vscode-cdn.net on vscode.dev). Dev-only — production
        // keeps the plain 'self' clickjacking guard.
        frameAncestors: isProduction
          ? ["'self'"]
          : ["'self'", "vscode-webview:", "https://*.vscode-cdn.net"]
      }
    },
    // In dev, allow the app to render inside VS Code's Simple Browser (a
    // cross-origin webview iframe). These frame/embedding guards stay on in prod.
    frameguard: isProduction,
    crossOriginOpenerPolicy: isProduction,
    crossOriginResourcePolicy: isProduction,
    // COEP (require-corp) blocks third-party sub-resources that don't send a
    // CORP header — including Razorpay's checkout.js — which broke sticker
    // checkout in production with "Razorpay is not defined". The app doesn't
    // use cross-origin isolation (SharedArrayBuffer etc.), so COEP buys us
    // nothing here; keep it off so the payment script loads.
    crossOriginEmbedderPolicy: false
  });

  // Multipart bodies, used only by the document vault upload. The file cap is
  // enforced here at the parser rather than after the fact, so an oversized
  // upload stops arriving instead of being read into memory and rejected later;
  // the route still checks `truncated`, because hitting this limit flags the
  // stream rather than throwing. `files: 1` keeps one request to one document.
  await app.register(fastifyMultipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 10 }
  });

  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: "1 minute",
    // Counters live in MongoDB so they hold ACROSS REPLICAS. The default store
    // counts in process memory, and this service runs several replicas on
    // Railway, so every declared limit was really `max × replicaCount`:
    // /api/auth/forgot-password is declared at 3/hour, but six consecutive
    // requests to production all returned 200 because no single replica saw
    // more than two of them. Only the per-route limits pay the round-trip —
    // the coarse 200/min guard below stays in memory. See rate-limit-store.js.
    store: createSharedRateLimitStore({
      // Resolved per request (lazily) rather than captured here: buildApp()
      // runs before the Mongo connection exists, and getCollections() returns
      // null when Mongo isn't configured at all, which the store treats as
      // "fall back to in-memory counting".
      getCollection: async () => (await getCollections(env))?.rateLimits ?? null,
      log: () => app.log
    }),
    // @fastify/rate-limit does `throw errorResponseBuilder(req, ctx)` — it
    // THROWS whatever this returns rather than sending it, so the value lands
    // in setErrorHandler below and must satisfy that handler's contract:
    //   • `statusCode` — or the handler falls through to its 500 branch;
    //   • `expose: true` + a string `message` — or clientErrorMessage()
    //     collapses it into the generic "Something went wrong" fallback.
    // A plain `{ ok, error }` object (what this used to return) satisfies
    // NEITHER, so every rate limit in the app — login, OTP send/verify, plate
    // verify, contact, register, forgot-password, COD OTP — answered a routine
    // throttle with HTTP 500 and an outage-shaped message. That also buried
    // genuine 500s in the metrics and left no 429 for clients to branch on.
    // ClientError already carries `expose: true`, so reuse it.
    errorResponseBuilder: () => {
      const error = clientError("Too many requests. Please slow down.");
      error.statusCode = 429;
      return error;
    }
  });

  // Catch-all for any error not already turned into a response by a route
  // handler (thrown validation errors, unexpected exceptions, etc). Fastify's
  // built-in default handler echoes `error.message` straight to the client,
  // which can leak internal details (DB driver errors, file paths, third-party
  // SDK internals). Only ClientError-marked messages (see lib/errors.js) are
  // ever shown verbatim; everything else is logged server-side and collapsed
  // into a generic message.
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;

    const message = clientErrorMessage(
      error,
      "Something went wrong. Please try again.",
      request.log
    );

    reply.code(statusCode).send({ ok: false, error: message });
  });

  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: "/",
    // Both were off, which is why nothing was ever reused: with no validator
    // there is nothing for a browser to revalidate against, so every stylesheet,
    // script and image came back in full on every visit. With them on, an
    // unchanged file answers a conditional request with a 304 and no body.
    etag: true,
    lastModified: true,
    // The real policy is per file, below. This stays 0 so that anything the
    // callback somehow does not classify is asked about rather than assumed
    // fresh — the safe direction to be wrong in.
    maxAge: 0,
    setHeaders(reply, _filePath, _stat) {
      const url = reply.request?.url ?? "";
      const split = url.indexOf("?");
      const pathname = split === -1 ? url : url.slice(0, split);
      const query = split === -1 ? "" : url.slice(split + 1);
      reply.header(
        "Cache-Control",
        cacheControlFor({
          pathname,
          requestedVersion: new URLSearchParams(query).get("v"),
          assetVersion
        })
      );
    }
  });

  app.get("/", async (request, reply) => {
    reply.redirect("/owner");
  });

  app.get("/hub", async (_request, reply) => {
    const html = await fs.readFile(hubPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // Front-end analytics, with the GA4 / Pixel IDs injected from env so each
  // environment reports into its own property (or, with both unset, into
  // nothing at all — which is what dev and staging should do).
  //
  // Served from a route rather than the static root because those IDs differ
  // per deploy. They are public values, so the only thing being protected here
  // is the cleanliness of the production analytics data.
  //
  // The marketing site at parktag.me loads this file from app.parktag.me, so
  // it must be readable cross-origin. Helmet's default in production is
  // Cross-Origin-Resource-Policy: same-origin, and under that the browser
  // blocks the script (ERR_BLOCKED_BY_RESPONSE) before a byte of it runs. That
  // was the state for the landing site's whole life: the script tag was in the
  // page, GA4 and the Pixel never loaded, and no landing session was recorded.
  // This one file is public by design, so it opts out of the default.
  app.get("/pt-analytics.js", async (_request, reply) => {
    const js = await fs.readFile(analyticsAsset, "utf8");
    reply.type("application/javascript");
    reply.header("Cache-Control", "public, max-age=300");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    return renderAnalyticsBundle(js, env);
  });

  app.get("/verify", async (_request, reply) => {
    const html = await fs.readFile(verifyPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // Public order lookup. Deliberately outside every auth check: a buyer who
  // picked a tag up in a shop, or checked out before creating an account, still
  // needs to be able to follow the parcel. The endpoint behind it is what
  // proves who is asking (order number + last 4 of the delivery phone).
  app.get("/track-order", async (_request, reply) => {
    const html = await fs.readFile(trackOrderPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // Public tag report. Like /track-order, deliberately unauthenticated — the
  // person best placed to tell us a tag is stale is the stranger standing at
  // the vehicle, and they will never have an account.
  app.get("/report-tag", async (_request, reply) => {
    const html = await fs.readFile(reportTagPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner-login", async (_request, reply) => {
    const html = await fs.readFile(ownerLoginPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    return reply.redirect("/owner-welcome");
  });

  // Public "buy a tag" entry point. Every order CTA on the marketing site aims
  // here instead of at /register-owner, so buying starts the way people expect
  // a shop to start — sign in, then browse — rather than by demanding vehicle
  // details from someone who has not bought anything yet.
  //
  // Signed in → straight to the dashboard with the Shop tab open. Signed out →
  // the login screen, flagged so it can hand the shop intent on to the
  // dashboard once the visitor is through (see owner/login.js).
  // A pack id from a query string, or null. Arrives from public links and is
  // put into a Location header downstream, so it is validated against the
  // catalogue here rather than trusted onward: an id that is not a real product
  // is dropped, and the worst a crafted link can do is open the shop.
  function skuFromQuery(request) {
    const requested = (request.query || {}).sku;
    return getShopProduct(typeof requested === "string" ? requested : "") ? requested : null;
  }

  // The shop. Public.
  //
  // This used to be an intent route that sent a signed-out visitor to
  // /owner-login, so every buy button on the marketing site landed on a login
  // screen before a single price was visible (docs/SHOP_LOGIN_WALL.md). The
  // storefront that fixed that was built at /get and nothing linked to it. It
  // now lives here, at the URL every button already points to.
  //
  // A signed-in owner still goes to the dashboard's shop tab, with the pack
  // carried across. Their order should hang off their account, not off a guest
  // order they would then have no way to see, and the dashboard is where the
  // orders they already have are listed.
  app.get("/shop", async (request, reply) => {
    const session = await readSession(app, request);
    const sku = skuFromQuery(request);

    if (session && session.role === "owner") {
      const carry = sku ? `&sku=${encodeURIComponent(sku)}` : "";
      return reply.redirect(`/owner-welcome?shop=1${carry}`);
    }

    // The page reads ?sku itself to highlight the chosen card; the value is
    // never echoed from here.
    const html = await fs.readFile(shopPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // The storefront's previous address. Redirected rather than removed so any
  // link that was handed out while it lived here still lands on the shop.
  // A storefront of its own, deliberately not linked from anywhere.
  //
  // It was folded into /shop and left as a redirect, on the reasoning that
  // nothing pointed at it. It is wanted back as a standalone page, so it serves
  // its own file again rather than forwarding.
  //
  // Nothing links here — not the marketing site, not the app nav, not /shop.
  // That is the point of it, and it is worth keeping true: this is a URL to be
  // handed out deliberately, so anyone arriving typed it or was sent it.
  //
  // It no longer reads ?sku. The redirect had to, because it put that value
  // into a Location header and an unvalidated pack id there is a header
  // injection; serving a file echoes nothing, so the whole question goes away.
  // A sku in the query is now simply ignored.
  app.get("/get", async (_request, reply) => {
    const html = await fs.readFile(getPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/register-owner", async (_request, reply) => {
    const html = await fs.readFile(registerOwnerPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner-verify", async (_request, reply) => {
    const html = await fs.readFile(ownerVerifyPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner-welcome", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    const html = await fs.readFile(ownerWelcomePage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/owner-vehicle-detail", async (_request, reply) => {
    const html = await fs.readFile(ownerVehicleDetailPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // The document vault. Session-gated like the dashboard rather than served
  // to anyone with the URL — the page itself reveals which vehicle is being
  // looked at, and the PIN prompt on it should be the second gate, not the
  // first. The documents themselves need the PIN on top of this.
  app.get("/owner-documents", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    const html = await fs.readFile(ownerDocumentsPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // The Login PIN screen. Session-gated: it manages a credential, so it must
  // never render for anyone who is not already signed in — and a redirect to
  // the sign-in page is the honest answer for a page that exists but is not
  // theirs to see.
  app.get("/owner-login-pin", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    const html = await fs.readFile(ownerLoginPinPage, "utf8");
    reply.type("text/html");
    return html;
  });

  // The membership screen. Session-gated like the rest of the owner area —
  // it is reached from the profile tab and is part of the signed-in app, not a
  // public price list.
  app.get("/owner-membership", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    const html = await fs.readFile(ownerMembershipPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/forgot-password", async (_request, reply) => {
    const html = await fs.readFile(forgotPasswordPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/reset-password", async (_request, reply) => {
    const html = await fs.readFile(resetPasswordPage, "utf8");
    reply.type("text/html");
    return html;
  });

  app.get("/admin", async (request, reply) => {
    const session = await readSession(app, request);

    if (session && session.role === "admin") {
      reply.redirect("/admin/overview");
      return;
    }

    const html = await fs.readFile(adminPage, "utf8");
    reply.type("text/html");
    return html;
  });

  async function guardAdmin(request, reply, pagePath) {
    const session = await readSession(app, request);

    if (!session || session.role !== "admin") {
      reply.redirect("/admin");
      return;
    }

    const html = await fs.readFile(pagePath, "utf8");
    reply.type("text/html");
    return html;
  }

  app.get("/admin/overview", async (request, reply) => {
    return guardAdmin(request, reply, adminOverviewPage);
  });

  app.get("/admin/etags", async (request, reply) => {
    return guardAdmin(request, reply, adminEtagsPage);
  });

  app.get("/admin/activations", async (request, reply) => {
    return guardAdmin(request, reply, adminActivationsPage);
  });

  app.get("/admin/issuance", async (request, reply) => {
    return guardAdmin(request, reply, adminIssuancePage);
  });

  app.get("/admin/print-queue", async (request, reply) => {
    return guardAdmin(request, reply, adminPrintQueuePage);
  });

  app.get("/admin/traffic", async (request, reply) => {
    return guardAdmin(request, reply, adminTrafficPage);
  });

  app.get("/admin/marketing", async (request, reply) => {
    return guardAdmin(request, reply, adminMarketingPage);
  });

  app.get("/admin/owners", async (request, reply) => {
    return guardAdmin(request, reply, adminOwnersPage);
  });

  app.get("/admin/activity", async (request, reply) => {
    return guardAdmin(request, reply, adminActivityPage);
  });

  app.get("/admin/admins", async (request, reply) => {
    return guardAdmin(request, reply, adminAdminsPage);
  });

  // Printable premium sticker for a given tag: the fixed SVG artwork with the
  // tag's OWN scannable QR overlaid (encodes the pinned production scan URL, so
  // printed stickers never point at localhost/whatever host generated them).
  app.get("/admin/sticker/:token([A-Za-z0-9]{6,80})", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "admin") {
      reply.redirect("/admin");
      return;
    }

    const token = request.params.token;
    // Use the pinned scan domain if configured, else the current host
    // (local→local, production→production). Both the proto and Host header are
    // client-controlled and get reflected into the returned HTML via
    // __SCAN_URL__, so constrain them to safe characters: an attacker can't
    // then smuggle markup through a crafted Host header (reflected XSS). If the
    // Host looks malformed, fall back to the configured app base URL.
    const rawProto = request.headers["x-forwarded-proto"] || request.protocol || "http";
    const proto = rawProto === "https" ? "https" : "http";
    const rawHost = request.headers.host || "";
    const host = /^[A-Za-z0-9.\-:]+$/.test(rawHost) ? rawHost : "";
    const base = env.scanBaseUrl || (host ? `${proto}://${host}` : env.appBaseUrl);
    const scanUrl = `${base}/tag/${token}`;
    // margin 2 keeps a quiet zone inside the QR image itself, which matters now
    // that the overlay fills the artwork's placeholder box edge to edge — with
    // margin 0 the modules would butt straight up against the box's black
    // keyline and scanners lose the finder patterns. Matches createPrintQrDataUrl.
    const qrSvg = await QRCode.toString(scanUrl, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M"
    });

    // Serial printed on the sticker face. stickerSerialFor reduces both halves
    // to digits, so the value can only be [A-Z0-9-] — nothing to escape here.
    const collections = await getCollections(env);
    const tag = await collections.tags.findOne({ token });
    const serial = tag ? stickerSerialFor(tag) : "";

    const html = await fs.readFile(stickerPrintPage, "utf8");
    reply.type("text/html");
    return html
      .replaceAll("__SCAN_URL__", scanUrl)
      .replaceAll("__SERIAL__", serial)
      .replace("<!--QR-->", qrSvg);
  });

  // Public scan landing page. Accepts both the new 256-bit hex tokens (64 chars)
  // and legacy 12-char tokens for backward compatibility. /tag is the spec URL;
  // /vehicle is kept as a working alias so already-printed stickers still resolve.
  async function serveScannerPage(reply) {
    const html = await fs.readFile(scannerPage, "utf8");
    setScannerNoCache(reply);
    reply.type("text/html");
    return html;
  }

  app.get("/tag/:token([A-Za-z0-9]{12,64})", async (_request, reply) => {
    return serveScannerPage(reply);
  });

  app.get("/vehicle/:token([A-Za-z0-9]{12,64})", async (_request, reply) => {
    return serveScannerPage(reply);
  });

  registerRuntimeRoutes(app, env);
  registerDemoRoutes(app, env);
  registerReviewerSetupRoute(app, env);
  registerPublicRoutes(app, env);
  registerProviderRoutes(app, env);
  registerMetaWebhookRoutes(app, env);
  registerRazorpayWebhookRoutes(app, env);
  registerRegistrationRoutes(app, env);
  registerAuthRoutes(app, env);
  registerOtpAuthRoutes(app, env);
  registerGoogleAuthRoutes(app, env);
  registerFirebasePhoneAuthRoute(app, env);
  registerPasswordResetRoutes(app, env);
  registerShopRoutes(app, env);
  registerOwnerRoutes(app, env);
  registerVaultRoutes(app, env);
  registerLoginPinRoutes(app, env);
  registerMembershipRoutes(app, env);
  registerAdminRoutes(app, env);
  registerAdminTrafficRoutes(app, env);
  registerAdminMarketingRoutes(app, env);
  registerAnalyticsRoutes(app, env);

  return app;
}
