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

export function getEnv() {
  const runtimeMode = readRuntimeMode(process.env.APP_ENV);

  return {
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
    emailSmtpHost: process.env.EMAIL_SMTP_HOST || "",
    emailSmtpPort: Number(process.env.EMAIL_SMTP_PORT) || 587,
    emailSmtpUser: process.env.EMAIL_SMTP_USER || "",
    emailSmtpPass: process.env.EMAIL_SMTP_PASS || "",
    emailFrom: process.env.EMAIL_FROM || "noreply@parktag.me",
    appBaseUrl: process.env.APP_BASE_URL || "http://localhost:4000",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://127.0.0.1:4000/api/auth/google/callback",
    firebaseApiKey: process.env.FIREBASE_API_KEY || "",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || ""
  };
}
