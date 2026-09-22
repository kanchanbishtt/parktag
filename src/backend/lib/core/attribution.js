// Which link brought a buyer here, carried from landing to order.
//
// A WhatsApp group post, a society poster and a Google ad all point at /get
// with utm_* on the URL, but the order is placed pages later, often after a
// reload, so the query string is long gone by checkout. The landing request
// writes it into a first-party cookie; order creation copies the cookie onto
// the order. Last touch wins: a newer tagged link replaces an older one.
//
// Values are the ones we put on our own links, so anything outside a short
// slug alphabet is dropped rather than stored. Nothing here is personal data.

export const ATTRIBUTION_COOKIE = "pt_attr";
const MAX_AGE_S = 30 * 24 * 60 * 60;
const KEYS = ["source", "medium", "campaign", "content", "term"];
const SLUG = /^[A-Za-z0-9_.\-+ ]{1,64}$/;

function clean(value) {
  const v = String(value ?? "").trim();
  return SLUG.test(v) ? v.toLowerCase() : null;
}

/** The utm_* on this URL, or null when it carries no usable utm_source. */
export function attributionFromQuery(query = {}, now = new Date()) {
  const out = {};
  for (const key of KEYS) {
    const v = clean(query[`utm_${key}`]);
    if (v) out[key] = v;
  }
  if (!out.source) return null;
  out.landedAt = now.toISOString();
  return out;
}

/** Read it back at order time. Unparseable or tampered cookies read as null. */
export function readAttribution(request) {
  const raw = request?.cookies?.[ATTRIBUTION_COOKIE];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const out = {};
    for (const key of KEYS) {
      const v = clean(parsed?.[key]);
      if (v) out[key] = v;
    }
    if (!out.source) return null;
    if (typeof parsed.landedAt === "string" && !Number.isNaN(Date.parse(parsed.landedAt))) out.landedAt = parsed.landedAt;
    return out;
  } catch {
    return null;
  }
}

/** onRequest: a page GET carrying utm_source remembers it. */
export function rememberAttribution(request, reply) {
  if (request.method !== "GET" || request.url.startsWith("/api/")) return;
  const found = attributionFromQuery(request.query || {});
  if (!found) return;
  reply.setCookie(ATTRIBUTION_COOKIE, JSON.stringify(found), {
    path: "/",
    maxAge: MAX_AGE_S,
    httpOnly: true,
    sameSite: "lax",
    secure: request.protocol === "https"
  });
}
