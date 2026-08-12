import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

import { getEnv } from "./lib/env.js";
import { clientErrorMessage } from "./lib/errors.js";
import { readSession } from "./lib/auth/session.js";
import { registerAdminRoutes } from "./routes/admin/index.js";
import { registerAuthRoutes } from "./routes/auth/credentials.js";
import { registerDemoRoutes } from "./routes/system/demo.js";
import { registerOwnerRoutes } from "./routes/owner/dashboard.js";
import { registerProviderRoutes } from "./routes/webhooks/exotel.js";
import { registerMetaWebhookRoutes } from "./routes/webhooks/meta.js";
import { registerPublicRoutes } from "./routes/public/index.js";
import { registerRegistrationRoutes } from "./routes/owner/registration.js";
import { registerOtpAuthRoutes } from "./routes/auth/otp.js";
import { registerGoogleAuthRoutes } from "./routes/auth/google.js";
import { registerFirebasePhoneAuthRoute } from "./routes/auth/firebase.js";
import { registerPasswordResetRoutes } from "./routes/auth/password-reset.js";
import { registerRuntimeRoutes } from "./routes/system/runtime.js";
import { registerReviewerSetupRoute } from "./routes/system/reviewer-setup.js";
import { registerShopRoutes } from "./routes/shop/index.js";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const frontendRoot = path.resolve(currentDir, "../frontend");
const pagesRoot = path.join(frontendRoot, "pages");
const scannerPage = path.join(pagesRoot, "scanner/index.html");
const verifyPage = path.join(pagesRoot, "scanner/verify.html");
const adminPage = path.join(pagesRoot, "admin/index.html");
const adminOverviewPage = path.join(pagesRoot, "admin/overview.html");
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
const forgotPasswordPage = path.join(pagesRoot, "owner/forgot-password.html");
const resetPasswordPage = path.join(pagesRoot, "owner/reset-password.html");
const ownerVerifyPage = path.join(pagesRoot, "owner/verify.html");
const ownerWelcomePage = path.join(pagesRoot, "owner/welcome.html");
const ownerVehicleDetailPage = path.join(pagesRoot, "owner/vehicle-detail.html");
const scannerAssetVersion = "parktag-ui-5";
const hubAssetVersion = "hub-shell-1";

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
    trustProxy: 1
  });

  // In-process cache in front of the MongoDB-backed session store (see
  // lib/auth/session.js). Sessions themselves live in Mongo, so a restart or a
  // second instance no longer logs users out — this Map is just a fast path.
  app.decorate("sessions", new Map());
  // Server-side OAuth state store — avoids SameSite cookie blocking on Google callback
  app.decorate("oauthStates", new Map());

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
          // Maze website-test snippet loader.
          "https://snippet.maze.co"
        ],
        // The owner/admin pages wire controls with inline onclick handlers.
        // Helmet defaults script-src-attr to 'none', which blocks ALL inline
        // event handlers — breaking the hamburger menu, Shop/Tags tabs,
        // "Continue with Google", Buy Now, etc. Allow inline handlers so those
        // controls work. (scriptSrc's 'unsafe-inline' does NOT cover event
        // handler attributes — script-src-attr is a separate directive.)
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://snippet.maze.co"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:", "https://snippet.maze.co"],
        imgSrc: ["'self'", "data:", "https://api.qrserver.com", "https://snippet.maze.co"],
        connectSrc: ["'self'", "https://www.google.com", "https://api.maze.co", "https://prompts.maze.co"],
        frameSrc: [
          "https://accounts.google.com",
          "https://*.razorpay.com",
          "https://www.google.com",
          "https://t.maze.co"
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"]
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

  await app.register(fastifyRateLimit, {
    max: 200,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      ok: false,
      error: "Too many requests. Please slow down."
    })
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
    maxAge: 0,
    etag: false,
    lastModified: false
  });

  app.get("/", async (request, reply) => {
    reply.redirect("/owner");
  });

  app.get("/hub", async (_request, reply) => {
    const html = await fs.readFile(hubPage, "utf8");
    reply.type("text/html");
    return html.replaceAll("__HUB_ASSET_VERSION__", hubAssetVersion);
  });

  app.get("/verify", async (_request, reply) => {
    const html = await fs.readFile(verifyPage, "utf8");
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
    const qrSvg = await QRCode.toString(scanUrl, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M"
    });

    const html = await fs.readFile(stickerPrintPage, "utf8");
    reply.type("text/html");
    return html.replaceAll("__SCAN_URL__", scanUrl).replace("<!--QR-->", qrSvg);
  });

  // Public scan landing page. Accepts both the new 256-bit hex tokens (64 chars)
  // and legacy 12-char tokens for backward compatibility. /tag is the spec URL;
  // /vehicle is kept as a working alias so already-printed stickers still resolve.
  async function serveScannerPage(reply) {
    const html = await fs.readFile(scannerPage, "utf8");
    setScannerNoCache(reply);
    reply.type("text/html");
    return html.replaceAll("__SCANNER_ASSET_VERSION__", scannerAssetVersion);
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
  registerRegistrationRoutes(app, env);
  registerAuthRoutes(app, env);
  registerOtpAuthRoutes(app, env);
  registerGoogleAuthRoutes(app, env);
  registerFirebasePhoneAuthRoute(app, env);
  registerPasswordResetRoutes(app, env);
  registerShopRoutes(app, env);
  registerOwnerRoutes(app, env);
  registerAdminRoutes(app, env);

  return app;
}
