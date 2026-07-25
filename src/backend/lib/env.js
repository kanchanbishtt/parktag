import dotenv from "dotenv";

dotenv.config();

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
  ["RAZORPAY_KEY_SECRET", "razorpayKeySecret"]
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
    // Optional override for the scan/activation domain used in printed-QR URLs.
    // Empty by default → QR uses the host it was generated on (local→local,
    // production→production). Set SCAN_BASE_URL=https://app.parktag.me in prod
    // if you ever generate stickers from a non-canonical host.
    scanBaseUrl: (process.env.SCAN_BASE_URL || "").replace(/\/+$/, ""),
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://127.0.0.1:4000/api/auth/google/callback",
    firebaseApiKey: process.env.FIREBASE_API_KEY || "",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
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
