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
    metaWhatsappAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || ""
  };
}
