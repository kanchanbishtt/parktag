import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

// The working copy of this repo lives in a cloud-synced folder, so real local
// secrets are kept outside it at ~/.parktag/.env (override with PARKTAG_ENV_FILE).
// Production injects env vars directly and reads no file; an in-repo .env is
// still honoured as a fallback so existing checkouts keep working.
const localEnvFile =
  process.env.PARKTAG_ENV_FILE || path.join(os.homedir(), ".parktag", ".env");

if (fs.existsSync(localEnvFile)) {
  dotenv.config({ path: localEnvFile });
} else {
  dotenv.config();
}

function readPort(value) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3000;
  }

  return parsed;
}

function readRuntimeMode(value) {
  if (!value) {
    return "dev";
  }

  const normalized = String(value).trim().toLowerCase();

  if (normalized === "production" || normalized === "prod") {
    return "production";
  }

  return "dev";
}

// Critical vars: the app cannot safely operate without these. In production
// we refuse to start rather than run in a half-configured, insecure state.
// (Non-production keeps the historical "run with degraded features" behavior
// so local dev doesn't require every integration to be configured.)
const REQUIRED_IN_PRODUCTION = [
  ["MONGODB_URI", "mongoUri"],
  ["RAZORPAY_KEY_ID", "razorpayKeyId"],
  ["RAZORPAY_KEY_SECRET", "razorpayKeySecret"],
  // Webhook auth secrets: without these the Exotel/Meta webhooks fall back to
  // accepting unauthenticated requests (see routes/webhooks/*). Requiring them
  // in production means the app refuses to boot mis-secured rather than leaking
  // private phone numbers / allowing forged status writes.
  ["EXOTEL_WEBHOOK_SECRET", "exotelWebhookSecret"],
  ["META_APP_SECRET", "metaAppSecret"],
  // Meta's GET verification handshake compares this against the caller's
  // `hub.verify_token`. Unset it defaults to "", which used to compare equal to
  // an empty token supplied by anyone — so the handshake passed for arbitrary
  // callers. The route now fails closed when it's missing; requiring it here
  // means a production deploy can't quietly reach that state at all.
  ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "metaWhatsappWebhookVerifyToken"]
];

function validateEnv(env, runtimeMode) {
  if (runtimeMode !== "production") return;

  const missing = REQUIRED_IN_PRODUCTION.filter(([, key]) => !env[key]).map(
    ([envName]) => envName
  );

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production: missing required environment variable(s): ${missing.join(", ")}.`
    );
  }
}

export function getEnv() {
  const runtimeMode = readRuntimeMode(process.env.APP_ENV);

  const env = {
    port: readPort(process.env.PORT),
    runtimeMode,
    mongoUri: process.env.MONGODB_URI || "",
    mongoDbName: process.env.MONGODB_DB_NAME || "wavetag",
    mongoCollectionPrefix:
      process.env.MONGODB_COLLECTION_PREFIX ||
      (runtimeMode === "production" ? "" : "dev_"),
    exotelApiBaseUrl: process.env.EXOTEL_API_BASE_URL || "https://api.in.exotel.com",
    exotelAccountSid: process.env.EXOTEL_ACCOUNT_SID || "",
    exotelApiKey: process.env.EXOTEL_API_KEY || "",
    exotelApiToken: process.env.EXOTEL_API_TOKEN || "",
    exotelCallerId: process.env.EXOTEL_CALLER_ID || "",
    exotelStatusCallbackUrl: process.env.EXOTEL_STATUS_CALLBACK_URL || "",
    exotelSmsSenderId: process.env.EXOTEL_SMS_SENDER_ID || "",
    exotelSmsDltEntityId: process.env.EXOTEL_SMS_DLT_ENTITY_ID || "",
    exotelSmsTemplateId: process.env.EXOTEL_SMS_TEMPLATE_ID || "",
    metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || "",
    metaWhatsappAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || "",
    metaWhatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    // No hardcoded fallback: an unset verify token must never silently
    // resolve to a value that's checked into source control.
    metaWhatsappWebhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "",
    // Meta App Secret (from the Meta App dashboard, NOT the WhatsApp access
    // token) — used to verify the `X-Hub-Signature-256` header Meta sends on
    // every webhook POST, so inbound webhook calls can be authenticated.
    metaAppSecret: process.env.META_APP_SECRET || "",
    // Exotel has no native request-signing scheme for callbacks. The
    // mitigation is a shared secret embedded as a query param in the callback
    // URLs configured in the Exotel dashboard (?token=...), checked on every
    // inbound request to /api/exotel/dial-whom and /api/provider/exotel/webhook.
    exotelWebhookSecret: process.env.EXOTEL_WEBHOOK_SECRET || "",
    emailSmtpHost: process.env.EMAIL_SMTP_HOST || "",
    emailSmtpPort: Number(process.env.EMAIL_SMTP_PORT) || 587,
    emailSmtpUser: process.env.EMAIL_SMTP_USER || "",
    emailSmtpPass: process.env.EMAIL_SMTP_PASS || "",
    emailFrom: process.env.EMAIL_FROM || "noreply@parktag.me",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:4000",
    // The marketing site, a separate Railway service. Used to recognise our own
    // host so an internal link is not counted as an inbound traffic source.
    landingBaseUrl: process.env.LANDING_BASE_URL || "",
    // ── Landing traffic geography ───────────────────────────────────────
    // Shared secret between the landing site's proxy (landing/proxy.ts) and
    // POST /api/analytics/landing-visit. The two run as different services, so
    // the visitor's IP arrives in the request body rather than on the socket —
    // this key is what makes that forwarded address trustworthy. Unset → the
    // ingest refuses every beacon (fail closed) and the Traffic page stays
    // empty; it is never a silent pass-through, because an open ingest would
    // let anyone invent traffic and write unbounded documents.
    analyticsIngestKey: process.env.ANALYTICS_INGEST_KEY || "",
    // Salt for the daily-rotating visitor digest. Optional: falls back to the
    // ingest key. Set it separately if you'd rather the two not share a value.
    analyticsHashSalt: process.env.ANALYTICS_HASH_SALT || "",
    // IP→location provider. Any URL containing `{ip}` that answers JSON with
    // country / region / city. Defaults to ipwho.is, which needs no key, so
    // traffic geography works on a fresh deploy with nothing configured.
    geoipUrl: process.env.GEOIP_URL || "",
    // Optional override for the scan/activation domain used in printed-QR URLs.
    // Empty by default → QR uses the host it was generated on (local→local,
    // production→production). Set SCAN_BASE_URL=https://app.parktag.me in prod
    // if you ever generate stickers from a non-canonical host.
    scanBaseUrl: (process.env.SCAN_BASE_URL || "").replace(/\/+$/, ""),
    // Public support handle shown on the sticker activation wizard ("Need help?
    // WhatsApp support"). Digits with country code, no "+" needed — e.g.
    // 919999999999. Unset → the help card is not rendered.
    supportWhatsappNumber: (process.env.SUPPORT_WHATSAPP_NUMBER || "").replace(/[^\d]/g, ""),
    // Front-end analytics IDs, served to the browser by GET /pt-analytics.js.
    // Both are PUBLIC identifiers (visible in any network tab), so they are not
    // secrets — they live here so staging and dev can leave them unset and stop
    // polluting the production GA4 property and Pixel with test traffic. Unset
    // → /pt-analytics.js ships a no-op and ptTrack() does nothing.
    ga4MeasurementId: process.env.GA4_MEASUREMENT_ID || "",
    metaPixelId: process.env.META_PIXEL_ID || "",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://127.0.0.1:4000/api/auth/google/callback",
    firebaseApiKey: process.env.FIREBASE_API_KEY || "",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    // Optional Google reCAPTCHA v3 (invisible bot score). BOTH must be set for
    // it to activate; unset → the OTP-send flow behaves exactly as before, so
    // local/dev and any deploy that hasn't configured keys stay fully working.
    // Site key is public (shipped to the browser); secret stays server-side.
    recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY || "",
    recaptchaSecret: process.env.RECAPTCHA_SECRET || "",
    // Optional reCAPTCHA v2 ("I'm not a robot" checkbox). A SEPARATE key pair
    // from v3 above — Google rejects a v3 key for the checkbox widget and vice
    // versa. Used by the tag-report form, which shows the checkbox rather than
    // scoring silently. Unset → the widget is not rendered and the server skips
    // verification, exactly as v3 does.
    recaptchaV2SiteKey: process.env.RECAPTCHA_V2_SITE_KEY || "",
    recaptchaV2Secret: process.env.RECAPTCHA_V2_SECRET || "",
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
    // Signs the Razorpay webhook body. A DIFFERENT secret from the key
    // secret above — it is set against the webhook endpoint in the Razorpay
    // dashboard. Without it the webhook refuses every callback, and a paid
    // order whose buyer closed the tab is never fulfilled.
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
    superAdminBootstrapKey: process.env.SUPER_ADMIN_BOOTSTRAP_KEY || "",
    reviewerSetupEmail: process.env.REVIEWER_SETUP_EMAIL || "",
    reviewerSetupPassword: process.env.REVIEWER_SETUP_PASSWORD || "",
    reviewerSetupMobile: process.env.REVIEWER_SETUP_MOBILE || "",
    reviewerSetupSecret: process.env.REVIEWER_SETUP_SECRET || "",
    // Defense-in-depth for POST /api/demo/seed (see routes/system/demo.js):
    // that route already refuses to register at all when APP_ENV=production,
    // but that is a single string comparison — a deploy that forgets to set
    // APP_ENV correctly would otherwise expose an UNAUTHENTICATED endpoint
    // that wipes every owners/admins/tags/contact_requests document and
    // reseeds a well-known admin/owner login (admin@wavetag.local / demo1234).
    // When this secret is set, it is also required on every seed call.
    demoSeedSecret: process.env.DEMO_SEED_SECRET || "",
    // ── Delhivery (physical sticker fulfilment) ─────────────────────────
    delhiveryApiKey: process.env.DELHIVERY_API_KEY || "",
    // Explicit override wins; otherwise staging in dev, production in prod —
    // never default to live shipment creation from a dev environment.
    delhiveryBaseUrl:
      process.env.DELHIVERY_BASE_URL ||
      (runtimeMode === "production"
        ? "https://track.delhivery.com"
        : "https://staging-express.delhivery.com"),
    // Must exactly match (case-sensitive) a warehouse/pickup location already
    // registered on the Delhivery account — created once via their dashboard
    // or account manager, not something this app creates programmatically.
    delhiveryPickupLocation: process.env.DELHIVERY_PICKUP_LOCATION || "",
    delhiverySellerGstTin: process.env.DELHIVERY_SELLER_GST_TIN || "",
    delhiveryHsnCode: process.env.DELHIVERY_HSN_CODE || ""
  };

  validateEnv(env, runtimeMode);

  return env;
}
