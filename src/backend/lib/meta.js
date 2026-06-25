function normalizeIndianNumber(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    return digits.replace("+", "");
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }
  return digits;
}

export function isMetaWhatsappConfigured(env) {
  return !!(env.metaWhatsappPhoneNumberId && env.metaWhatsappAccessToken);
}

export async function sendMetaWhatsappOtp(env, { to, code }) {
  if (!isMetaWhatsappConfigured(env)) {
    throw new Error("Meta WhatsApp is not configured.");
  }

  const toNumber = normalizeIndianNumber(to);
  const url = `https://graph.facebook.com/v19.0/${env.metaWhatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaWhatsappAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toNumber,
      type: "template",
      template: {
        name: "parktag_login",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: code }]
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: code }]
          }
        ]
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    const err = new Error("Unable to send WhatsApp OTP.");
    err.providerDetail = detail.slice(0, 1000);
    throw err;
  }

  return data;
}

export async function sendMetaWhatsapp(env, input) {
  if (!isMetaWhatsappConfigured(env)) {
    throw new Error("Meta WhatsApp is not configured: missing metaWhatsappPhoneNumberId or metaWhatsappAccessToken");
  }

  const to = normalizeIndianNumber(input.to);
  const url = `https://graph.facebook.com/v19.0/${env.metaWhatsappPhoneNumberId}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.metaWhatsappAccessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: input.body }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const detail = data?.error?.message || JSON.stringify(data);
    const err = new Error("Unable to send the WhatsApp message right now.");
    err.providerDetail = detail.slice(0, 1000);
    err.providerStatusCode = response.status;
    throw err;
  }

  return data;
}
