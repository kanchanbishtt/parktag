import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCompress from "@fastify/compress";
import { rememberAttribution } from "./lib/core/attribution.js";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

import { getEnv } from "./lib/env.js";
import { captureServerError, shouldReport } from "./lib/integrations/sentry.js";
import { renderAnalyticsBundle, INTERNAL_ANALYTICS_BUNDLE } from "./lib/analytics.js";
import { isInternalIp } from "./lib/core/internal-orders.js";
import { referralCodeShape } from "./lib/core/referrals.js";
import { BoundedTtlMap } from "./lib/bounded-map.js";
import { clientError, clientErrorMessage } from "./lib/errors.js";
import { readSession } from "./lib/auth/session.js";
import { adminAccountExists, tryObjectId } from "./lib/auth/auth.js";
import { createSharedRateLimitStore } from "./lib/auth/rate-limit-store.js";
import { getCollections } from "./lib/db/repositories.js";
import { trustProxy } from "./lib/core/proxy-trust.js";
import { stickerSerialFor } from "./lib/core/tag-issuance.js";
import { getPublishedStickerDesign, overlayStyles, printSpecFor } from "./lib/core/sticker-design.js";
import { registerSlackCommandRoutes } from "./routes/webhooks/slack.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAdminTrafficRoutes } from "./routes/admin/traffic.js";
import { registerAdminMarketingRoutes } from "./routes/admin/marketing.js";
import { registerAdminDoorhangerRoutes } from "./routes/admin/doorhangers.js";
import { registerAdminStickerDesignRoutes } from "./routes/admin/sticker-designs.js";
import { registerAdminPromoCodeRoutes } from "./routes/admin/promo-codes.js";
import { registerAdminReviewRoutes } from "./routes/admin/reviews.js";
import { registerAdminOrderRoutes } from "./routes/admin/orders.js";
import { registerAdminTagReportRoutes } from "./routes/admin/tag-reports.js";
import { registerAdminApiTokenRoutes } from "./routes/admin/api-tokens.js";
import { registerMcpRoutes } from "./routes/mcp/index.js";
import { PENDING_COOKIE as OAUTH_PENDING_COOKIE, registerOAuthRoutes, resumeAuthorize } from "./routes/oauth/index.js";
import { registerAuthRoutes } from "./routes/auth/credentials.js";
import { registerAnalyticsRoutes, recordAppPageVisit } from "./routes/system/analytics.js";
import { registerDemoRoutes } from "./routes/system/demo.js";
import { registerOwnerRoutes } from "./routes/owner/dashboard.js";
import { registerVaultRoutes } from "./routes/owner/vault.js";
import { registerLoginPinRoutes } from "./routes/owner/login-pin.js";
import { registerPushRoutes } from "./routes/owner/push.js";
import { registerMembershipRoutes } from "./routes/owner/membership.js";
import { registerCallbackPassRoutes } from "./routes/owner/callback-pass.js";
import { MAX_FILE_BYTES } from "./lib/core/vault.js";
import { cacheControlFor, resolveAssetVersion } from "./lib/core/asset-version.js";
import { isQuietUrl, isPublicStaticPath, pathnameOf } from "./lib/core/request-policy.js";
import { createRenderedFileStore, etagFor, matchesEtag } from "./lib/core/static-pages.js";
import { renderServiceWorker, assetLinks, normaliseSha256Fingerprint, ANDROID_APP_PACKAGE } from "./lib/core/pwa.js";
import { stampScriptImports } from "./lib/core/import-stamp.js";
import { registerProviderRoutes } from "./routes/webhooks/exotel.js";
import { registerMetaWebhookRoutes } from "./routes/webhooks/meta.js";
import { registerRazorpayWebhookRoutes } from "./routes/webhooks/razorpay.js";
import { registerPublicRoutes } from "./routes/public/index.js";
import { registerBackupContactRoutes } from "./routes/public/backup-contact.js";
import { registerOtpAuthRoutes } from "./routes/auth/otp.js";
import { registerGoogleAuthRoutes } from "./routes/auth/google.js";
import { registerFirebasePhoneAuthRoute } from "./routes/auth/firebase.js";
import { registerPasswordResetRoutes } from "./routes/auth/password-reset.js";
import { registerRuntimeRoutes } from "./routes/system/runtime.js";
import { registerShopRoutes } from "./routes/shop/index.js";
import { registerShopReviewRoutes } from "./routes/shop/reviews.js";
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
// Same reason: the owner app's service worker is stamped with a version on the
// way out (see /sw.js below), so its source must not be reachable unstamped.
const serviceWorkerAsset = path.join(currentDir, "assets/sw.js");
const scannerPage = path.join(pagesRoot, "scanner/index.html");
const offlinePage = path.join(pagesRoot, "offline.html");
const notFoundPage = path.join(pagesRoot, "not-found.html");
const verifyPage = path.join(pagesRoot, "scanner/verify.html");
const trackOrderPage = path.join(pagesRoot, "scanner/track-order.html");
const reportTagPage = path.join(pagesRoot, "scanner/report-tag.html");
const backupContactPage = path.join(pagesRoot, "scanner/backup-contact.html");
const adminPage = path.join(pagesRoot, "admin/index.html");
const adminMarketingPage = path.join(pagesRoot, "admin/marketing.html");
const adminPromoCodesPage = path.join(pagesRoot, "admin/promo-codes.html");
const adminReviewsPage = path.join(pagesRoot, "admin/reviews.html");
const adminOrdersPage = path.join(pagesRoot, "admin/orders.html");
const adminTagReportsPage = path.join(pagesRoot, "admin/tag-reports.html");
const adminApiTokensPage = path.join(pagesRoot, "admin/api-tokens.html");
const adminOverviewPage = path.join(pagesRoot, "admin/overview.html");
const adminTrafficPage = path.join(pagesRoot, "admin/traffic.html");
const adminEtagsPage = path.join(pagesRoot, "admin/etags.html");
const adminActivationsPage = path.join(pagesRoot, "admin/activations.html");
const adminIssuancePage = path.join(pagesRoot, "admin/issuance.html");
const adminPrintQueuePage = path.join(pagesRoot, "admin/print-queue.html");
const adminOwnersPage = path.join(pagesRoot, "admin/owners.html");
const adminActivityPage = path.join(pagesRoot, "admin/activity.html");
const adminAdminsPage = path.join(pagesRoot, "admin/admins.html");
const adminStickerDesignerPage = path.join(pagesRoot, "admin/sticker-designer.html");
const stickerPrintPage = path.join(pagesRoot, "admin/sticker-print.html");
const registerOwnerPage = path.join(pagesRoot, "owner/register.html");
const ownerLoginPage = path.join(pagesRoot, "owner/login.html");
const shopPage = path.join(pagesRoot, "shop.html");
const getPage = path.join(pagesRoot, "get.html");
const directPage = path.join(pagesRoot, "direct.html");
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

// The public storefront: no inline <script> and no inline handlers, so it can
// lose 'unsafe-inline' from script-src outright. It cannot take the checkout
// list above, because unlike /owner-welcome it also loads reCAPTCHA and
// Clarity, so this keeps the app-wide origins and drops only the keyword.
// style-src is left alone: address-step.js injects its own <style> element.
const NO_INLINE_KEYWORD_PAGES = new Set(["/get"]);

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

// The app-wide script-src minus 'unsafe-inline' — every origin it allows stays
// allowed, only inline script stops running. See NO_INLINE_KEYWORD_PAGES.
function dropInlineScriptKeyword(policy) {
  return String(policy)
    .split(";")
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) =>
      directive.startsWith("script-src ")
        ? directive.split(/\s+/).filter((token) => token !== "'unsafe-inline'").join(" ")
        : directive
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

// Every request used to be logged twice (incoming and completed), including the
// 30 to 50 asset fetches behind one page view and the health check a monitor
// calls every few seconds. Those are left out; anything that errored or came
// back 4xx/5xx is still logged, as is every API request.
const { LogController } = Fastify;
export class AccessLogController extends LogController {
  incomingRequest(request, reply, metadata) {
    if (isQuietUrl(request.url)) return;
    super.incomingRequest(request, reply, metadata);
  }

  requestCompleted(error, request, reply, metadata) {
    if (!error && reply.statusCode < 400 && isQuietUrl(request.url)) return;
    super.requestCompleted(error, request, reply, metadata);
  }
}

export async function buildApp() {
  const env = getEnv();
  const app = Fastify({
    logController: new AccessLogController(),
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
    // 5 junk POSTs to /api/auth/login (or /send-otp, /activate,
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
    // That "if the deployment ever gains another proxy hop" happened. Railway
    // now puts two of its own machines in front of this process, so one hop
    // stopped on a Railway edge address instead of the caller: activity rows
    // told owners every scan came from Singapore (the sin1 PoP), and every
    // per-IP limit collapsed into one bucket per PoP.
    //
    // The replacement recognises our own infrastructure and stops at the first
    // address that is not ours, so it survives Railway adding or removing a
    // layer instead of silently mis-reporting again. It is still capped, so it
    // can never walk off the end of the chain into caller-controlled values.
    // See lib/core/proxy-trust.js for the reasoning and the ranges.
    trustProxy
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
      request.rawBody = Buffer.from(body);
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
  // /oauth/authorize is the consent decision: a cookie-authorised POST that hands an app admin power. (Its sibling
  // /oauth/token and /oauth/register are cookie-less calls from the app itself, so they stay out.)
  const CSRF_PROTECTED_PREFIXES = ["/api/auth/", "/api/owner/", "/api/admin/", "/api/shop/", "/oauth/authorize"];
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

  // Remember which tagged link a visitor landed from, for the order record.
  app.addHook("onRequest", async (request, reply) => {
    rememberAttribution(request, reply);
  });

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

    // Nothing under /api/ may be kept by a browser history, proxy or CDN unless
    // its route says so: they carry session-scoped data. A route that sets its
    // own Cache-Control (a public catalogue, a download) keeps it. The webhook
    // endpoints answer providers, not browsers, and are left exactly as they
    // were.
    if (
      pathname.startsWith("/api/") &&
      !pathname.startsWith("/api/provider/") &&
      !pathname.startsWith("/api/exotel/") &&
      !reply.getHeader("cache-control")
    ) {
      reply.header("Cache-Control", "no-store");
    }

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
    } else if (NO_INLINE_KEYWORD_PAGES.has(pathname)) {
      const policy = reply.getHeader("content-security-policy");
      if (policy) {
        reply.header("content-security-policy", dropInlineScriptKeyword(policy));
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
    return typeof payload === "string" && payload.includes(ASSET_VERSION_TOKEN)
      ? payload.replaceAll(ASSET_VERSION_TOKEN, assetVersion)
      : payload;
  });

  // Response compression, negotiated per request from Accept-Encoding: zstd
  // when the client advertises it (Node 22.15+ only; skipped otherwise), then
  // brotli, then gzip, and an uncompressed body for anything else. A client
  // that never asked for an encoding is never sent one, so older browsers and
  // mobile HTTP clients keep working unchanged.
  //
  // Registered after the onSend hook above so pages are stamped with the asset
  // version before they are compressed, and before fastifyStatic as the plugin
  // requires. Request decompression stays off: no client sends encoded bodies,
  // and the webhook routes verify signatures against the raw bytes.
  await app.register(fastifyCompress, {
    encodings: ["zstd", "br", "gzip"],
    globalDecompression: false
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
          "https://connect.facebook.net",
          // Microsoft Clarity, storefront pages only (see assets/analytics.js).
          "https://www.clarity.ms",
          "https://*.clarity.ms"
        ],
        // The owner/admin pages wire controls with inline onclick handlers.
        // Helmet defaults script-src-attr to 'none', which blocks ALL inline
        // event handlers — breaking the hamburger menu, Shop/Tags tabs,
        // "Continue with Google", Buy Now, etc. Allow inline handlers so those
        // controls work. (scriptSrc's 'unsafe-inline' does NOT cover event
        // handler attributes — script-src-attr is a separate directive.)
        scriptSrcAttr: ["'unsafe-inline'"],
        // Fonts are self-hosted (/fonts); nothing loads from Google Fonts.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        // Both trackers still deliver some hits as image beacons, which
        // img-src governs rather than connect-src.
        imgSrc: [
          "'self'",
          "data:",
          "https://api.qrserver.com",
          "https://*.google-analytics.com",
          "https://analytics.google.com",
          "https://*.analytics.google.com",
          "https://www.google.com",
          "https://www.google.co.in",
          "https://*.doubleclick.net",
          "https://*.googletagmanager.com",
          "https://www.facebook.com",
          "https://*.clarity.ms",
          "https://c.bing.com"
        ],
        // Where the trackers actually POST. Blocking these is subtler than
        // blocking the loaders: the scripts run, ptTrack() reports success, and
        // the events die at the network boundary.
        connectSrc: [
          "'self'",
          // India Post PIN lookup: the delivery sheet fills City and State from it.
          "https://api.postalpincode.in",
          "https://identitytoolkit.googleapis.com",
          "https://www.google.com",
          "https://www.google.co.in",
          "https://*.google-analytics.com",
          // The apex host, not only the wildcard: gtag reports to
          // https://analytics.google.com/g/collect, and a "*." source never
          // matches the bare domain. Same list as landing/next.config.ts.
          "https://analytics.google.com",
          "https://*.analytics.google.com",
          "https://stats.g.doubleclick.net",
          "https://*.googletagmanager.com",
          "https://www.facebook.com",
          "https://connect.facebook.net",
          // Microsoft Clarity, storefront pages only (see assets/analytics.js).
          "https://www.clarity.ms",
          "https://*.clarity.ms"
        ],
        // www.facebook.com: the Pixel falls back to a hidden iframe + form post when
        // its image beacon is unavailable. Without it every /get view logs two CSP
        // violations and that fallback silently loses the event.
        frameSrc: ["https://accounts.google.com", "https://*.razorpay.com", "https://www.google.com", "https://www.facebook.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Netbanking is the one Razorpay method that leaves Razorpay's frame:
        // the checkout posts a form that sends the window on to the bank, by
        // way of api.razorpay.com. With only 'self' here the browser refused
        // that navigation and the buyer saw a blank page where the bank's
        // login should have been. Cards, UPI and wallets never leave the frame
        // and were unaffected. (Razorpay's own CSP guidance lists these two.)
        formAction: ["'self'", "https://www.facebook.com", "https://api.razorpay.com", "https://*.razorpay.com"],
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
    // Assets and the health check are not what the limit is for. A first load
    // of one page fetches 30 to 50 of them, and on a carrier NAT many phones
    // share one address, so counting them locks real visitors out.
    allowList: (request) => isQuietUrl(request.url),
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

    if (shouldReport(statusCode, error)) {
      captureServerError(error, { request, statusCode });
    }

    reply.code(statusCode).send({ ok: false, error: message });
  });

  // An address the app has no page for. A browser asking for a page gets a
  // ParkTag "page not found" screen; everything else (the API, scripts, images,
  // webhooks) keeps the JSON Fastify has always sent, in the same shape.
  //
  // Fastify's JSON used to reach people too: a scan page refreshed after its
  // token was stripped from the address bar showed `{"message":"Route
  // GET:/vehicle not found",...}` to the person standing at the car.
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = pathnameOf(request.url);
    const wantsPage =
      (request.method === "GET" || request.method === "HEAD") &&
      !pathname.startsWith("/api/") &&
      String(request.headers.accept || "").includes("text/html");
    reply.code(404);
    if (wantsPage) {
      reply.header("Cache-Control", "no-store");
      return servePage(request, reply, notFoundPage, { validators: false });
    }
    return {
      message: `Route ${request.method}:${request.url} not found`,
      error: "Not Found",
      statusCode: 404
    };
  });

  await app.register(fastifyStatic, {
    root: frontendRoot,
    prefix: "/",
    // The raw page shells under pages/ are reachable only through their named
    // routes (which set the per-page CSP and cache headers and stamp assets).
    allowedPath: isPublicStaticPath,
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
      // Public images, stylesheets and fonts may be loaded by other origins.
      // Microsoft Clarity replays pages from clarity.microsoft.com, and with
      // the helmet default (same-origin) every photo, the logo and the demo
      // video came back broken in the replay. Nothing under these paths is
      // private; pages and scripts keep same-origin.
      if (/^\/(images|styles|fonts)\//.test(pathname)) {
        reply.header("Cross-Origin-Resource-Policy", "cross-origin");
      }
    }
  });

  // ── Versioned ES modules ──────────────────────────────────────────────────
  //
  // A script requested with the current ?v= is served with the imports inside
  // it stamped with the same version (see lib/core/import-stamp.js), so the
  // whole module graph is immutable rather than only its entry point. A request
  // with no version, or a stale one, is not touched here and falls through to
  // the static handler exactly as before.
  //
  // In production the rewritten file is read once and kept with its ETag. In
  // dev it is re-read per request so an edit shows on reload.
  const scriptsRoot = path.join(frontendRoot, "scripts");
  const loadStampedScript = createRenderedFileStore({
    memoize: isProduction,
    transform: (source) => stampScriptImports(source, assetVersion)
  });

  async function stampedScriptFor(url) {
    const query = url.indexOf("?");
    if (query === -1) return null;
    const version = new URLSearchParams(url.slice(query + 1)).get("v");
    if (!version || version !== assetVersion) return null;

    let pathname;
    try {
      pathname = decodeURIComponent(pathnameOf(url));
    } catch {
      return null;
    }
    if (!pathname.startsWith("/scripts/") || !pathname.endsWith(".js")) return null;

    const file = path.resolve(frontendRoot, `.${pathname}`);
    if (!file.startsWith(scriptsRoot + path.sep)) return null;

    try {
      return await loadStampedScript(file);
    } catch {
      // Missing or unreadable: let the static handler answer (a 404).
      return null;
    }
  }

  // After helmet (registered above), so its security headers are already on the
  // reply this sends.
  app.addHook("onRequest", async (request, reply) => {
    if (request.method !== "GET" || !request.url.startsWith("/scripts/")) return;

    const script = await stampedScriptFor(request.url);
    if (!script) return;

    reply.header("Content-Type", "text/javascript; charset=UTF-8");
    reply.header("Cache-Control", cacheControlFor({
      pathname: pathnameOf(request.url),
      requestedVersion: assetVersion,
      assetVersion
    }));
    reply.header("ETag", script.etag);
    if (matchesEtag(request.headers["if-none-match"], script.etag)) {
      return reply.code(304).send();
    }
    return reply.send(script.body);
  });

  // ── HTML pages ────────────────────────────────────────────────────────────
  //
  // Each page is read from disk and stamped with the asset version once, on
  // first use, and served from memory after that; the same for every visitor,
  // so nothing about a page depends on who asks. In dev the file is re-read per
  // request so edits show live.
  //
  // Public shells (/get, /shop, /direct, /verify, ...) are sent with a weak
  // ETag and answer If-None-Match with a 304, so a returning visitor downloads
  // nothing. Pages that are no-store (signed-in views, the admin console, the
  // scanner) send no validator: their whole point is that a browser keeps
  // nothing, and a 304 is a kept copy.
  const loadPage = createRenderedFileStore({
    memoize: isProduction,
    transform: (html) => html.replaceAll(ASSET_VERSION_TOKEN, assetVersion)
  });

  async function servePage(request, reply, file, { validators = true } = {}) {
    const page = await loadPage(file);
    reply.type("text/html");

    if (validators && !isNoStorePage(pathnameOf(request.url))) {
      reply.header("ETag", page.etag);
      if (matchesEtag(request.headers["if-none-match"], page.etag)) {
        return reply.code(304).send();
      }
    }
    return page.body;
  }

  app.get("/", async (request, reply) => {
    reply.redirect("/owner");
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
  //
  // The rendered bundle is built once per process on first request and served
  // from memory with an ETag (in dev it is re-read each time so edits show).
  // Five minutes fresh, then a day of stale-while-revalidate, so a returning
  // visitor is never held up waiting on it.
  const loadAnalytics = createRenderedFileStore({
    memoize: isProduction,
    transform: (js) => renderAnalyticsBundle(js, env)
  });

  app.get("/pt-analytics.js", async (request, reply) => {
    // Our own network gets a bundle that measures nothing (INTERNAL_IPS).
    // Decided before the public ETag is looked at, or an office browser
    // holding the public copy would be told "304, keep using it".
    //
    // Stored but never trusted (no-cache), with an ETag of its own. Stored,
    // because that is what replaces a public copy the browser already holds:
    // an unstorable answer would leave the old one in place, to be served
    // stale for a day. Never trusted, so every load asks again and a laptop
    // taken home gets the real bundle the moment its address changes. Private,
    // so no shared cache can hand this to a customer.
    if (isInternalIp(env, request.ip)) {
      const internalEtag = '"pt-internal"';
      reply.type("application/javascript");
      reply.header("Cache-Control", "private, no-cache");
      reply.header("Cross-Origin-Resource-Policy", "cross-origin");
      reply.header("ETag", internalEtag);
      if (matchesEtag(request.headers["if-none-match"], internalEtag)) {
        return reply.code(304).send();
      }
      return INTERNAL_ANALYTICS_BUNDLE;
    }

    const bundle = await loadAnalytics(analyticsAsset);
    reply.type("application/javascript");
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=86400");
    reply.header("Cross-Origin-Resource-Policy", "cross-origin");
    reply.header("ETag", bundle.etag);
    if (matchesEtag(request.headers["if-none-match"], bundle.etag)) {
      return reply.code(304).send();
    }
    return bundle.body;
  });

  // ── The owner app's service worker and offline page ───────────────────────
  //
  // /sw.js has to be served from the root: a worker's scope cannot reach above
  // the path it was loaded from, and the owner pages live at /owner-*. The
  // source sits under src/backend/assets (not reachable raw), and the version
  // stamped into it folds in the offline page, so editing either file makes
  // the browser install a fresh worker. `no-cache`, so a deploy is picked up
  // on the next visit rather than after the browser's 24-hour cap; the ETag
  // turns that check into a 304. See lib/core/pwa.js and wiki/owner-pwa.md.
  const loadServiceWorkerSource = createRenderedFileStore({ memoize: isProduction });

  app.get("/sw.js", async (request, reply) => {
    const [source, offline] = await Promise.all([
      loadServiceWorkerSource(serviceWorkerAsset),
      loadPage(offlinePage)
    ]);
    const body = renderServiceWorker(source.body, { assetVersion, offlineHtml: offline.body });
    const etag = etagFor(body);
    reply.type("text/javascript; charset=utf-8");
    reply.header("Cache-Control", "no-cache");
    reply.header("ETag", etag);
    if (matchesEtag(request.headers["if-none-match"], etag)) {
      return reply.code(304).send();
    }
    return body;
  });

  // What the worker shows when the phone has no connection. A public shell
  // like /verify: the worker fetches it once at install and keeps its own copy.
  app.get("/offline", async (request, reply) => {
    return servePage(request, reply, offlinePage);
  });

  // The statement that lets the Play Store app (a Trusted Web Activity) show
  // this site with no browser bar. Android fetches it once per install, so an
  // hour of caching costs nothing; 404 until ANDROID_APP_SHA256_FINGERPRINTS
  // is set, because an empty statement is worse than none. See lib/core/pwa.js.
  const androidAssetLinks = assetLinks({
    packageName: ANDROID_APP_PACKAGE,
    fingerprints: env.androidAppSha256Fingerprints
  });
  // A fingerprint that was set but is not 32 bytes of hex is dropped from the
  // statement; said once here, because the only other symptom is a browser bar
  // on a phone. Counts, not values: a fingerprint is public, a typo of one is
  // noise in the log.
  {
    const configured = env.androidAppSha256Fingerprints.length;
    const valid = env.androidAppSha256Fingerprints.filter((f) => normaliseSha256Fingerprint(f)).length;
    if (configured > valid) {
      app.log.warn(
        `[android app] ANDROID_APP_SHA256_FINGERPRINTS: ${configured - valid} of ${configured} entries are not a SHA-256 fingerprint and were dropped` +
        (valid === 0 ? "; /.well-known/assetlinks.json answers 404 until one is valid" : "")
      );
    }
  }

  app.get("/.well-known/assetlinks.json", async (request, reply) => {
    if (!androidAssetLinks) {
      reply.code(404);
      return { ok: false, error: "No Android app is configured." };
    }
    reply.header("Cache-Control", "public, max-age=3600");
    return androidAssetLinks;
  });

  app.get("/verify", async (request, reply) => {
    return servePage(request, reply, verifyPage);
  });

  // Public order lookup. Deliberately outside every auth check: a buyer who
  // picked a tag up in a shop, or checked out before creating an account, still
  // needs to be able to follow the parcel. The endpoint behind it is what
  // proves who is asking (order number + last 4 of the delivery phone).
  app.get("/track-order", async (request, reply) => {
    return servePage(request, reply, trackOrderPage);
  });

  // Public tag report. Like /track-order, deliberately unauthenticated — the
  // person best placed to tell us a tag is stale is the stranger standing at
  // the vehicle, and they will never have an account.
  app.get("/report-tag", async (request, reply) => {
    return servePage(request, reply, reportTagPage);
  });

  // "Remove my number", the button in the WhatsApp notice a backup contact
  // gets (lib/core/backup-contact.js). The page only asks; the POST behind its
  // button does the work (routes/public/backup-contact.js).
  app.get("/backup/:token", async (request, reply) => {
    return servePage(request, reply, backupContactPage);
  });

  app.get("/owner-login", async (request, reply) => {
    return servePage(request, reply, ownerLoginPage);
  });

  // ParkTag's own number as a downloadable contact card.
  //
  // There is no web API that can write a contact — the Contact Picker API only
  // READS, and only on Android — so a vCard the browser hands to the operating
  // system is the whole mechanism. Tapping the link opens the OS contact screen
  // with the fields already filled; the person still confirms the save, which is
  // the only behaviour a page is allowed to have here.
  //
  // Built as a constant rather than read off disk: it is four lines that never
  // change, and a missing file would turn a save-our-number button into a 500.
  //
  // CRLF and the VERSION line are not stylistic. RFC 6350 specifies CRLF, and
  // Android's importer is strict about it; 3.0 rather than 4.0 because it is the
  // version every version of iOS and Android in circulation reads.
  const contactCard = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:;ParkTag;;;",
    "FN:ParkTag",
    "ORG:ParkTag by EditTree",
    "TEL;TYPE=WORK,VOICE:08047284348",
    "END:VCARD",
    ""
  ].join("\r\n");

  app.get("/parktag.vcf", async (_request, reply) => {
    reply
      .header("content-type", "text/vcard; charset=utf-8")
      .header("content-disposition", 'attachment; filename="ParkTag.vcf"')
      .header("cache-control", "public, max-age=86400");
    return contactCard;
  });

  // The installed app opens here. The Play Store app launches it with
  // ?pt_app=android, which rides along on the redirect so the first page with
  // a script on it (scripts/pwa.js) can tell it was opened from that app.
  app.get("/owner", async (request, reply) => {
    const suffix = request.query && request.query.pt_app === "android" ? "?pt_app=android" : "";
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login" + suffix);
    }
    return reply.redirect("/owner-welcome" + suffix);
  });

  // ── /v/:tagId — the vehicle deep link ────────────────────────────────────
  //
  // Exists because of a Meta constraint and an ownership one.
  //
  // A WhatsApp URL button is a FIXED approved base plus exactly ONE variable
  // suffix. The dashboard needs a session, and the vehicle views want several
  // parameters, so neither can be linked to directly from a template. This is
  // the single short URL a template can carry.
  //
  // It matters most on the owner alert. That message tells somebody a stranger
  // is standing at their car, and CALLBACK_WINDOW_MS gives them ten minutes to
  // ring that person back — a window that, until now, expired while they looked
  // for an app that does not exist.
  //
  // The id is the tag's ObjectId, deliberately NOT its scan token. The token is
  // the QR secret printed on the sticker; putting it in a message that can be
  // forwarded would hand a stranger the scan page for that vehicle.
  //
  // Every failure lands on the same place, and that is the point: a tag that
  // does not exist and a tag belonging to somebody else are indistinguishable
  // from outside, so this cannot be used to test whether an id is real.
  app.get("/v/:tagId", async (request, reply) => {
    const tagId = tryObjectId(request.params.tagId);
    const session = await readSession(app, request);

    if (!session || session.role !== "owner") {
      // Signed out. The intent travels as a query string ONLY as far as the
      // login page, which parks it in sessionStorage — sign-in hops through
      // screens we do not control (the OTP step, the Google round trip) and a
      // query string is dropped on the way. Same mechanism as ?next=shop.
      const suffix = tagId ? `&tag=${encodeURIComponent(String(tagId))}` : "";
      return reply.redirect(`/owner-login?next=vehicle${suffix}`);
    }

    if (!tagId) return reply.redirect("/owner-welcome");

    let collections = null;
    try {
      collections = await getCollections(env);
    } catch {
      // The database is unreachable. The dashboard will say so far better than
      // a stack trace would, and a 500 on a link somebody tapped from a message
      // about their car is the worst possible answer.
      return reply.redirect("/owner-welcome");
    }
    if (!collections) return reply.redirect("/owner-welcome");

    const tag = await collections.tags
      .findOne({ _id: tagId }, { projection: { ownerId: 1 } })
      .catch(() => null);

    // String comparison: session.userId is a string and tag.ownerId is an
    // ObjectId, so == would be false for the rightful owner and every alert
    // button would silently land on the plain dashboard.
    if (!tag || !tag.ownerId || String(tag.ownerId) !== String(session.userId)) {
      return reply.redirect("/owner-welcome");
    }

    // The Activity list is where the Call Back button lives (welcome.js), and
    // it is on the default view, so no tab switch is needed — only the scroll.
    return reply.redirect(`/owner-welcome?v=${encodeURIComponent(String(tagId))}`);
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
      // A friend's ?ref= rides along too: the shop page that would have parked
      // it (referral-link.js) never loads for a signed-in owner, and the
      // dashboard parks it from its own address bar instead.
      const ref = referralCodeShape((request.query || {}).ref);
      const carry = (sku ? `&sku=${encodeURIComponent(sku)}` : "") + (ref ? `&ref=${ref}` : "");
      return reply.redirect(`/owner-welcome?shop=1${carry}`);
    }

    // Counted here rather than in the browser. The shop is where the ads
    // land, so this is the number the spend is judged on, and a client-side
    // tag is the one thing a visitor can switch off.
    recordAppPageVisit(app, env, request, "/shop");

    // The page reads ?sku itself to highlight the chosen card; the value is
    // never echoed from here.
    return servePage(request, reply, shopPage);
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
  app.get("/get", async (request, reply) => {
    // Counted like /shop. This page is handed out deliberately, so knowing
    // whether anyone actually opened it is the only way to tell.
    recordAppPageVisit(app, env, request, "/get");

    return servePage(request, reply, getPage);
  });

  // The direct-sale checkout. Handed to somebody who has already been quoted a
  // price, so it is never linked from anywhere and carries a noindex.
  //
  // Counted like /get and /shop: this page exists to be sent to one person at a
  // time, and whether they actually opened it is the only signal there is.
  app.get("/direct", async (request, reply) => {
    recordAppPageVisit(app, env, request, "/direct");

    return servePage(request, reply, directPage);
  });

  app.get("/register-owner", async (request, reply) => {
    return servePage(request, reply, registerOwnerPage);
  });

  app.get("/owner-verify", async (request, reply) => {
    return servePage(request, reply, ownerVerifyPage);
  });

  app.get("/owner-welcome", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    return servePage(request, reply, ownerWelcomePage);
  });

  app.get("/owner-vehicle-detail", async (request, reply) => {
    return servePage(request, reply, ownerVehicleDetailPage);
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
    return servePage(request, reply, ownerDocumentsPage);
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
    return servePage(request, reply, ownerLoginPinPage);
  });

  // The membership screen. Session-gated like the rest of the owner area —
  // it is reached from the profile tab and is part of the signed-in app, not a
  // public price list.
  app.get("/owner-membership", async (request, reply) => {
    const session = await readSession(app, request);
    if (!session || session.role !== "owner") {
      return reply.redirect("/owner-login");
    }
    return servePage(request, reply, ownerMembershipPage);
  });

  app.get("/forgot-password", async (request, reply) => {
    return servePage(request, reply, forgotPasswordPage);
  });

  app.get("/reset-password", async (request, reply) => {
    return servePage(request, reply, resetPasswordPage);
  });

  // An admin session whose admin still exists (see adminAccountExists). If the
  // database cannot say, the page is not served: every admin page needs it for
  // its data anyway, and the login page is the safe place to land.
  async function isSignedInAdmin(request) {
    const session = await readSession(app, request);
    if (!session || session.role !== "admin") return false;
    try {
      return await adminAccountExists(session.userId);
    } catch {
      return false;
    }
  }

  app.get("/admin", async (request, reply) => {
    if (await isSignedInAdmin(request)) {
      // An OAuth connect (Claude adding the admin MCP) may have sent them here to sign in first.
      if (!resumeAuthorize(request, reply)) reply.redirect("/admin/overview");
      return;
    }

    return servePage(request, reply, adminPage);
  });

  async function guardAdmin(request, reply, pagePath) {
    if (!(await isSignedInAdmin(request))) {
      reply.redirect("/admin");
      return;
    }

    return servePage(request, reply, pagePath);
  }

  app.get("/admin/overview", async (request, reply) => {
    // Google sign-in lands here rather than on /admin, so it has to resume a waiting OAuth connect too.
    if (request.cookies?.[OAUTH_PENDING_COOKIE] && (await isSignedInAdmin(request)) && resumeAuthorize(request, reply)) return;
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

  app.get("/admin/promo-codes", async (request, reply) => {
    return guardAdmin(request, reply, adminPromoCodesPage);
  });

  app.get("/admin/reviews", async (request, reply) => {
    return guardAdmin(request, reply, adminReviewsPage);
  });

  app.get("/admin/orders", async (request, reply) => {
    return guardAdmin(request, reply, adminOrdersPage);
  });

  app.get("/admin/tag-reports", async (request, reply) => {
    return guardAdmin(request, reply, adminTagReportsPage);
  });

  app.get("/admin/api-tokens", async (request, reply) => {
    return guardAdmin(request, reply, adminApiTokensPage);
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

  app.get("/admin/sticker-designer", async (request, reply) => {
    return guardAdmin(request, reply, adminStickerDesignerPage);
  });

  // Printable premium sticker for a given tag: the fixed SVG artwork with the
  // tag's OWN scannable QR overlaid (encodes the pinned production scan URL, so
  // printed stickers never point at localhost/whatever host generated them).
  app.get("/admin/sticker/:token([A-Za-z0-9]{6,80})", async (request, reply) => {
    if (!(await isSignedInAdmin(request))) {
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

    // The published design from /admin/sticker-designer, or the original
    // artwork when none is. The URL and styles are built from an ObjectId,
    // an encoded timestamp and validated numbers, so they need no escaping.
    const spec = printSpecFor(await getPublishedStickerDesign(collections));
    const styles = overlayStyles(spec.layout);

    const html = (await loadPage(stickerPrintPage)).body;
    reply.type("text/html");
    return html
      .replaceAll("__SCAN_URL__", scanUrl)
      .replaceAll("__SERIAL__", serial)
      .replaceAll("__ARTWORK_URL__", spec.artworkUrl)
      .replaceAll("__QR_STYLE__", styles.qr)
      .replaceAll("__SERIAL_STYLE__", styles.serial)
      .replace("<!--QR-->", qrSvg);
  });

  // Public scan landing page. Accepts both the new 256-bit hex tokens (64 chars)
  // and legacy 12-char tokens for backward compatibility. /tag is the spec URL;
  // /vehicle is kept as a working alias so already-printed stickers still resolve.
  async function serveScannerPage(request, reply) {
    setScannerNoCache(reply);
    return servePage(request, reply, scannerPage, { validators: false });
  }

  app.get("/tag/:token([A-Za-z0-9]{12,64})", async (request, reply) => {
    return serveScannerPage(request, reply);
  });

  app.get("/vehicle/:token([A-Za-z0-9]{12,64})", async (request, reply) => {
    return serveScannerPage(request, reply);
  });

  // The same page with no token in the path. After a scan, pt-analytics.js
  // rewrites the address bar to plain "/vehicle" so the Meta Pixel never sees
  // a tag token, which made every refresh of a scan page a raw JSON 404. The
  // page now finds its token in the tab's sessionStorage (scanner/app.js) and,
  // when there is none, asks the visitor to scan the sticker again.
  app.get("/vehicle", async (request, reply) => serveScannerPage(request, reply));
  app.get("/tag", async (request, reply) => serveScannerPage(request, reply));

  registerRuntimeRoutes(app, env);
  registerDemoRoutes(app, env);
  registerPublicRoutes(app, env);
  registerBackupContactRoutes(app, env);
  registerProviderRoutes(app, env);
  registerMetaWebhookRoutes(app, env);
  registerRazorpayWebhookRoutes(app, env);
  registerSlackCommandRoutes(app, env);
  registerAuthRoutes(app, env);
  registerOtpAuthRoutes(app, env);
  registerGoogleAuthRoutes(app, env);
  registerFirebasePhoneAuthRoute(app, env);
  registerPasswordResetRoutes(app, env);
  registerShopRoutes(app, env);
  registerShopReviewRoutes(app, env);
  registerOwnerRoutes(app, env);
  registerVaultRoutes(app, env);
  registerLoginPinRoutes(app, env);
  registerPushRoutes(app, env);
  registerMembershipRoutes(app, env);
  registerCallbackPassRoutes(app, env);
  registerAdminRoutes(app, env);
  registerAdminTrafficRoutes(app, env);
  registerAdminMarketingRoutes(app, env);
  registerAdminDoorhangerRoutes(app, env);
  registerAdminStickerDesignRoutes(app, env);
  registerAdminPromoCodeRoutes(app, env);
  registerAdminReviewRoutes(app, env);
  registerAdminOrderRoutes(app, env);
  registerAdminTagReportRoutes(app, env);
  registerAdminApiTokenRoutes(app, env);
  registerOAuthRoutes(app, env);
  registerMcpRoutes(app, env);
  registerAnalyticsRoutes(app, env);

  return app;
}
