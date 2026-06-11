function normalizeBaseUrl(input) {
  const value = String(input || "").trim();

  if (!value) {
    return "";
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  return `https://${value}`;
}

function maskPhoneLikeValue(input) {
  const value = String(input);

  return value.replace(/\+?\d[\d -]{5,}\d/g, (match) => {
    const digits = match.replace(/\D/g, "");

    if (digits.length < 7) {
      return match;
    }

    const visible = digits.slice(-4);
    return `${"*".repeat(Math.max(digits.length - 4, 3))}${visible}`;
  });
}

function sanitizeProviderDetail(input) {
  if (input === null || input === undefined) {
    return null;
  }

  const raw =
    typeof input === "string" ? input : JSON.stringify(input);

  return maskPhoneLikeValue(raw).slice(0, 1000);
}

class ExotelProviderError extends Error {
  constructor(publicMessage, detail, statusCode) {
    super(publicMessage);
    this.name = "ExotelProviderError";
    this.providerDetail = detail;
    this.providerStatusCode = statusCode;
  }
}

function ensureExotelConfig(env, required) {
  const keys = [
    "exotelApiBaseUrl",
    "exotelAccountSid",
    "exotelApiKey",
    "exotelApiToken",
    ...required
  ];

  const missing = keys.filter((key) => !env[key]);

  if (missing.length) {
    throw new Error(`Exotel is not configured: missing ${missing.join(", ")}`);
  }
}

function createBasicAuth(env) {
  return Buffer.from(`${env.exotelApiKey}:${env.exotelApiToken}`).toString("base64");
}

function buildVoiceUrl(env) {
  const base = normalizeBaseUrl(env.exotelApiBaseUrl).replace(/\/+$/, "");
  return `${base}/v1/Accounts/${env.exotelAccountSid}/Calls/connect`;
}

function buildMessageUrl(env) {
  const base = normalizeBaseUrl(env.exotelApiBaseUrl).replace(/\/+$/, "");
  return `${base}/v2/accounts/${env.exotelAccountSid}/messages`;
}

function toFormBody(payload) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(payload)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }

    params.append(key, String(value));
  }

  return params;
}

function normalizeIndianNumber(input) {
  const raw = String(input || "").trim();

  if (!raw) {
    throw new Error("Phone number is required");
  }

  const digits = raw.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    return digits;
  }

  if (digits.length === 10) {
    return `+91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return `+${digits}`;
  }

  return digits;
}

function buildProviderFailure(responseStatus, data) {
  const detail =
    data?.message ||
    data?.error_data?.message ||
    data?.error ||
    data?.raw ||
    data;

  return {
    statusCode: responseStatus,
    detail: sanitizeProviderDetail(detail)
  };
}

async function postForm(url, auth, payload, publicMessage) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: toFormBody(payload)
  });

  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const failure = buildProviderFailure(response.status, data);
    throw new ExotelProviderError(
      publicMessage,
      failure.detail,
      failure.statusCode
    );
  }

  return data;
}

async function postJson(url, auth, payload, publicMessage) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const failure = buildProviderFailure(response.status, data);
    throw new ExotelProviderError(
      publicMessage,
      failure.detail,
      failure.statusCode
    );
  }

  return data;
}

export async function triggerExotelCall(env, input) {
  ensureExotelConfig(env, ["exotelCallerId"]);

  const auth = createBasicAuth(env);
  const url = buildVoiceUrl(env);
  const from = normalizeIndianNumber(input.from);
  const to = normalizeIndianNumber(input.to);

  const payload = {
    From: from,
    To: to,
    CallerId: env.exotelCallerId,
    CallType: "trans",
    StatusCallback: env.exotelStatusCallbackUrl || undefined,
    "StatusCallbackEvents[]": ["terminal", "answered"],
    CustomField: input.requestId
  };

  return postForm(url, auth, payload, "Unable to start the call right now.");
}

export async function sendExotelMessage(env, input) {
  ensureExotelConfig(env, ["exotelWhatsappFrom"]);

  const auth = createBasicAuth(env);
  const url = buildMessageUrl(env);
  const to = normalizeIndianNumber(input.to);

  const payload = {
    whatsapp: {
      messages: [
        {
          from: env.exotelWhatsappFrom,
          to,
          content: {
            type: "text",
            text: {
              body: input.body
            }
          }
        }
      ]
    }
  };

  return postJson(
    url,
    auth,
    payload,
    "Unable to send the WhatsApp message right now."
  );
}
