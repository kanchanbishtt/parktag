// What the MCP tools call the admin API through. Requests run inside this process (app.inject), carrying the caller's
// own bearer token, so they pass the same scope allowlist, rate limits and audit log as an external call would.
// Pure helpers (links, promo codes, money) live here too so tools.js stays about tools.

import { PROMO_CODE_PATTERN } from "../lib/core/promo-codes.js";
import { SLUG } from "../lib/core/attribution.js";

const ADMIN_PATH = /^\/api\/admin\/[A-Za-z0-9_\-./]+$/;
const MAX_TEXT = 60_000;

export function slug(name, value) {
  const v = String(value).trim();
  if (!SLUG.test(v)) throw new Error(`${name} must be 1-64 letters, numbers, hyphens, dots or underscores.`);
  return v.toLowerCase();
}

export function promoCode(value) {
  const v = String(value).trim().toUpperCase();
  if (!PROMO_CODE_PATTERN.test(v)) throw new Error("Promo code must be 4-16 letters and numbers, no spaces or symbols.");
  return v;
}

export const rupeesToPaise = (r) => Math.round(Number(r) * 100);

/** /direct?promo=..&sku=..&utm_*=..  utm_source is required or the backend records no attribution at all. */
export function buildUtmLink({ baseUrl, path = "/direct", promo, sku, source, medium, campaign, content, term }) {
  if (!/^\/[A-Za-z0-9_\-./]*$/.test(path) || path.includes("//")) throw new Error("path must be a site path like /direct.");
  const q = new URLSearchParams();
  if (promo) q.set("promo", promoCode(promo));
  if (sku) q.set("sku", slug("sku", sku));
  if (!source) throw new Error("utm_source is required.");
  for (const [k, v] of Object.entries({ source, medium, campaign, content, term })) if (v) q.set(`utm_${k}`, slug(`utm_${k}`, v));
  return `${baseUrl.replace(/\/+$/, "")}${path}?${q}`;
}

export const trim = (text) =>
  text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n... truncated (${text.length} chars). Narrow the query or page.` : text;

/** An admin API client bound to one request: its bearer token and the caller's address. */
export function createInternalClient(app, { authorization, remoteAddress }) {
  async function call(method, path, { query, body, auth = true, lenient = false } = {}) {
    const url = new URL(path, "http://internal");
    for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    const res = await app.inject({
      method, url: `${url.pathname}${url.search}`, remoteAddress,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization } : {}) },
      payload: body ? JSON.stringify(body) : undefined
    });
    let data;
    try { data = JSON.parse(res.body); } catch { throw new Error(`HTTP ${res.statusCode} from ${path}: ${res.body.slice(0, 200)}`); }
    if (lenient) return data;
    if (res.statusCode >= 400 || data?.ok === false) throw new Error(data?.error || `HTTP ${res.statusCode} from ${path}`);
    return data;
  }

  return {
    /** Read-only escape hatch: any GET under /api/admin/. */
    adminGet(path, query) {
      if (!ADMIN_PATH.test(path) || path.split("/").includes("..")) throw new Error("path must start with /api/admin/ and contain no '..'.");
      return call("GET", path, { query });
    },
    get: (path, query) => call("GET", path, { query }),
    send: (method, path, body) => call(method, path, { body: method === "DELETE" ? undefined : body ?? {} }),
    /** Public, unauthenticated: does this code exist and what does it price to? */
    checkPromo: (code, productId) => call("POST", "/api/shop/promo/check", { auth: false, lenient: true, body: { code, productId, quantity: 1 } })
  };
}
