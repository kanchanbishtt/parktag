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
  ["WHATSAPP_WEBHOOK_VERIFY_TOKEN", "metaWhatsappWebhookVerifyToken"],
  // Razorpay's is here for the opposite reason to the two above. Those endpoints
  // fall back to accepting UNAUTHENTICATED requests without their secret, so
  // requiring them stops the app booting mis-secured. The Razorpay webhook fails
  // closed on its own — no secret means it refuses every callback — so a missing
  // value is never a security hole.
  //
  // It is required because of what the refusal costs. Fulfilment then rests
  // entirely on the buyer's browser completing one more request after their
  // money has already left; miss it and the order sits at "created" with no tag
  // minted, no shipment booked and nothing server-side aware anything is owed.
  // That failure is silent, it is only visible in a support ticket, and it was
  // live in production until 2026-09-02. A refusal to boot is a much cheaper
  // way to find out than a customer who paid and received nothing.
  ["RAZORPAY_WEBHOOK_SECRET", "razorpayWebhookSecret"]
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
    exotelAccountSid: process.env.EXOTEL_ACCOUNT_SID || "",
    exotelApiKey: process.env.EXOTEL_API_KEY || "",
    exotelApiToken: process.env.EXOTEL_API_TOKEN || "",
    exotelCallerId: process.env.EXOTEL_CALLER_ID || "",
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
    // ── The Android app (Play Store, a Trusted Web Activity) ────────────────
    // Digital Asset Links: Android opens the app without a browser bar only
    // once /.well-known/assetlinks.json names the app's package and the
    // SHA-256 of the certificate it was signed with. The package name is a
    // constant (lib/core/pwa.js), because scripts/pwa.js has to know the same
    // name; the fingerprints have no default, and the route answers 404 until
    // they are set, so a deploy with no Play app serves no statement. Comma or
    // newline separated (Play Console lists them one per line): the upload key
    // and Play's app-signing key are both legitimate signers while the listing
    // is being set up. Malformed entries are dropped and logged at start-up.
    androidAppSha256Fingerprints: (process.env.ANDROID_APP_SHA256_FINGERPRINTS || "")
      .split(/[,\r\n]+/).map((f) => f.trim()).filter(Boolean),
    // ── Scheduled campaigns ─────────────────────────────────────────────
    // OFF unless explicitly switched on, and the default is the point. This
    // process sends WhatsApp messages to real customers on a timer, and it also
    // runs on every developer's laptop and in every test run. Opt-in is the
    // only default under which a local `npm run dev` cannot message anybody.
    schedulerEnabled: process.env.SCHEDULER_ENABLED === "1",
    // Select recipients, log them, send nothing. Run this against production
    // data before the first live tick of any new campaign: a wrong date
    // comparison matches every row, and on WhatsApp there is no recall.
    campaignDryRun: process.env.CAMPAIGN_DRY_RUN === "1",
    // The review request campaign's own switch. Set it only once Meta shows
    // parktag_review_request_v1 as APPROVED and UTILITY: sending an unapproved
    // template fails every time, and a MARKETING one needs consent this
    // campaign does not check. See lib/core/campaigns/review-request.js.
    reviewRequestsEnabled: process.env.REVIEW_REQUESTS_ENABLED === "1",
    // The activation-reminder campaign's own switch, for the same reason as the
    // review request above: sendOnce() claims its dedupe row BEFORE the send and
    // never retries, so a send against a template that is not yet approved would
    // permanently burn each order (one failed attempt, no reminder ever). Keep
    // this off until Meta shows parktag_activation_reminder as APPROVED and
    // UTILITY. See lib/core/campaigns/activation-reminder.js.
    activationRemindersEnabled: process.env.ACTIVATION_REMINDERS_ENABLED === "1",
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
    // Key for the keyed hash that remembers a spent E-Tag free call after its
    // account is deleted (lib/core/tag-issuance.js). Optional: falls back to
    // META_APP_SECRET, which production always has. Changing it only forgets
    // those records, so a returning owner gets a free call again.
    freeCallHashKey: process.env.FREE_CALL_HASH_KEY || "",
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
    clarityProjectId: process.env.CLARITY_PROJECT_ID || "",
    // Error monitoring (lib/integrations/sentry.js). Unset → nothing is sent.
    sentryDsn: process.env.SENTRY_DSN || "",
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET || "",
    slackTeamId: process.env.SLACK_TEAM_ID || "",
    slackChannelId: process.env.SLACK_CHANNEL_ID || "",
    slackAdminUserIds: process.env.SLACK_ADMIN_USER_IDS || "",
    metaPixelId: process.env.META_PIXEL_ID || "",
    // Conversions API. Unlike the two IDs above this one IS a secret — it is a
    // system-user access token from Events Manager and can write events to the
    // dataset. Unset → lib/integrations/meta-capi.js no-ops, which is the
    // correct state for dev and staging.
    metaCapiAccessToken: process.env.META_CAPI_ACCESS_TOKEN || "",
    // Optional. Set it only while verifying in Events Manager → Test Events;
    // events carrying it are routed to the test view instead of live reporting.
    metaCapiTestEventCode: process.env.META_CAPI_TEST_EVENT_CODE || "",
    // Owner-dashboard product analytics (retention, not the marketing funnel —
    // see lib/integrations/mixpanel.js for why that stays server-side only).
    // Unset → the module no-ops, the correct state for dev and staging.
    mixpanelToken: process.env.MIXPANEL_TOKEN || "",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://127.0.0.1:4000/api/auth/google/callback",
    firebaseApiKey: process.env.FIREBASE_API_KEY || "",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    // Native app push (FCM HTTP v1). The whole service-account JSON as one
    // string. Unset: push sends no-op. A secret.
    fcmServiceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON || "",
    // App Check token verification for the native app's send-otp. The numeric
    // project number (the token issuer) and a comma list of accepted app ids.
    // Unset: App Check tokens are ignored and reCAPTCHA applies as before.
    firebaseProjectNumber: process.env.FIREBASE_PROJECT_NUMBER || "",
    appCheckAppIds: process.env.APPCHECK_APP_IDS || "",
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
    // Auto-renew (Razorpay Subscriptions). The ids of the recurring PLANS created
    // out of band (scripts/create-subscription-plans.js) — their prices live in
    // Razorpay, never here. The switch is off until those plans exist AND auto
    // renew has been verified in test mode: a subscribe call needs a real plan
    // id, and entitlement is extended only by the subscription.charged webhook,
    // so there is nothing to half-charge while it is off. See
    // lib/core/subscription-plans.js and routes/owner/membership.js.
    razorpaySubPlanMonthly: process.env.RAZORPAY_SUB_PLAN_MONTHLY || "",
    razorpaySubPlanAnnual: process.env.RAZORPAY_SUB_PLAN_ANNUAL || "",
    subscriptionsEnabled: process.env.SUBSCRIPTIONS_ENABLED === "1",
    superAdminBootstrapKey: process.env.SUPER_ADMIN_BOOTSTRAP_KEY || "",
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
    delhiveryHsnCode: process.env.DELHIVERY_HSN_CODE || "",
    // When the rider should come. A knob rather than a constant because it is
    // the one pickup value that depends on somebody being at the address to
    // hand the parcel over, which is a fact about the day rather than about
    // the code. 24-hour, with seconds, as Delhivery expects.
    //
    // 10:00 is the START of the warehouse's registered preferred pickup slot
    // (10:00 to 14:00, working hours 10:00 to 18:00). This defaulted to 14:00
    // until that record was actually read, which was the slot's closing edge
    // and left no room for the rider to be late.
    delhiveryPickupTime: process.env.DELHIVERY_PICKUP_TIME || "10:00:00",
    // Where the daily Amazon pickup job reports (an n8n webhook that posts to
    // Slack). Optional: unset means the job still runs and just stays quiet.
    pickupNotifyWebhookUrl: process.env.PICKUP_NOTIFY_WEBHOOK_URL || "",
    // Amazon SP-API (private self-authorised app, Orders role). When set, the
    // amazon-pickup job books a pickup as each Amazon order arrives instead of
    // the blind 21:00 sweep. See lib/integrations/amazon-sp.js.
    amazonLwaClientId: process.env.AMAZON_LWA_CLIENT_ID || "",
    amazonLwaClientSecret: process.env.AMAZON_LWA_CLIENT_SECRET || "",
    amazonLwaRefreshToken: process.env.AMAZON_LWA_REFRESH_TOKEN || "",
    // Where abandoned checkouts are reported (an n8n webhook that posts to
    // Slack). Optional: unset means the job stays off.
    abandonedNotifyWebhookUrl: process.env.ABANDONED_NOTIFY_WEBHOOK_URL || "",
    // Our own mobile numbers, comma separated. Orders placed to one of these
    // are marked internal and kept out of revenue.
    //
    // Configuration rather than a constant because a list of real mobile
    // numbers has no business in a public repository, and it changes whenever
    // somebody joins or leaves. Unset means nothing is internal, which
    // over-reports our testing rather than hiding a real sale. See
    // lib/core/internal-orders.js.
    internalTestPhones: process.env.INTERNAL_TEST_PHONES || "",
    // Our own public IP addresses (the office line), comma separated. A
    // browser on one of them is served an analytics bundle that measures
    // nothing, so our own clicking stays out of GA4, the Pixel and Clarity.
    // Unset means every visit is measured. See lib/core/internal-orders.js.
    internalIps: process.env.INTERNAL_IPS || ""
  };

  // Strip surrounding whitespace from every configured string.
  //
  // Pasting a secret into a hosting dashboard is how these values get set, and
  // a paste that picks up the trailing newline stores it: RAZORPAY_KEY_ID went
  // live as a key id with a trailing newline glued to it. Nothing here is a
  // value where an outer space or newline is meaningful, but plenty of them are
  // values where one is fatal and invisible — a credential with a trailing
  // newline is still a non-empty string, so every
  // `if (!env.foo)` guard and every REQUIRED_IN_PRODUCTION check passes, and the
  // failure surfaces far away as a 401 from someone else's API. That is exactly
  // how the shop checkout broke: create-order reported "Failed to create order",
  // because Razorpay rejected the auth for a key id it could not match.
  //
  // Done here, over the whole object, rather than per-variable at each
  // `process.env.X ||` above: the next credential added is protected without
  // anyone remembering to, and the trim runs BEFORE validateEnv so a var set to
  // nothing but whitespace is correctly reported as missing instead of counting
  // as configured.
  // Say which ones needed it, rather than trimming in silence.
  //
  // The trim makes a padded credential work, which also makes it invisible —
  // and the value in the hosting dashboard is still wrong. Left unsaid, the
  // next person to read that variable, copy it to another service, or paste it
  // into a support ticket inherits the same newline and the same five-week
  // outage. Names only: the whole point is that these are secrets.
  const padded = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed !== value && trimmed !== "") padded.push(key);
    env[key] = trimmed;
  }
  if (padded.length) {
    console.warn(
      `[env] trimmed surrounding whitespace from: ${padded.join(", ")}. ` +
        "The stored value still contains it — fix it at the source."
    );
  }

  validateEnv(env, runtimeMode);

  return env;
}
