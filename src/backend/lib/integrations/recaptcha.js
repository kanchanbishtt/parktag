// Google reCAPTCHA v3 verification (invisible bot scoring).
//
// The whole feature is OPT-IN: it only does anything when BOTH RECAPTCHA_SITE_KEY
// and RECAPTCHA_SECRET are set. When unconfigured, verifyRecaptcha() returns
// { ok: true, skipped: true } so the OTP-send flow keeps working unchanged in
// local/dev and on any deploy that hasn't set the keys.

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
// v3 returns a 0..1 score (1 = very likely human). 0.5 is Google's suggested
// default cut-off; below it we treat the request as bot-like and reject.
const MIN_SCORE = 0.5;

export function isRecaptchaConfigured(env) {
  return Boolean(env.recaptchaSiteKey && env.recaptchaSecret);
}

// Returns { ok: boolean, ... }. Callers should reject the request when ok is
// false. Never throws — all failure paths resolve to a plain object.
export async function verifyRecaptcha(env, token, { remoteIp, expectedAction } = {}) {
  // Not configured → no-op pass-through (feature is off).
  if (!isRecaptchaConfigured(env)) return { ok: true, skipped: true };

  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing-token" };
  }

  let data;
  try {
    const params = new URLSearchParams({
      secret: env.recaptchaSecret,
      response: token
    });
    if (remoteIp) params.set("remoteip", remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString()
    });
    data = await res.json();
  } catch (err) {
    // Google's verifier is unreachable (their outage or a network blip). Fail
    // OPEN so a transient problem on Google's side can't lock every user out of
    // login. The per-IP and per-destination OTP rate limits still apply, so a
    // brief window of unscored requests is not a meaningful bypass.
    return { ok: true, degraded: true, error: err && err.message };
  }

  if (!data || data.success !== true) {
    return { ok: false, reason: "verify-failed", detail: data && data["error-codes"] };
  }
  // Guard against a token minted for a different form/action being replayed here.
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, reason: "action-mismatch", action: data.action };
  }
  if (typeof data.score === "number" && data.score < MIN_SCORE) {
    return { ok: false, reason: "low-score", score: data.score };
  }
  return { ok: true, score: data.score };
}
