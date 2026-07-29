// Invisible reCAPTCHA v3 helper.
//
// Fully inert unless the server reports a site key: getCaptchaToken() then
// returns "" and no Google script is ever loaded, so local/dev and any deploy
// without keys behave exactly as before. There is no visible UI change beyond
// reCAPTCHA's small floating badge, which only appears once the script loads.

let _siteKeyPromise = null;
let _scriptPromise = null;

function getSiteKey() {
  if (!_siteKeyPromise) {
    _siteKeyPromise = fetch("/api/auth/recaptcha/config")
      .then((r) => r.json())
      .then((d) => (d && d.siteKey) || "")
      .catch(() => "");
  }
  return _siteKeyPromise;
}

function loadScript(siteKey) {
  if (_scriptPromise) return _scriptPromise;
  _scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => window.grecaptcha.ready(() => resolve());
    s.onerror = () => reject(new Error("recaptcha-load-failed"));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

// Returns a reCAPTCHA token for the given action, or "" when reCAPTCHA is not
// configured. Never throws — on any error it resolves to "" so it can be
// dropped into a request body without extra guarding at the call site.
export async function getCaptchaToken(action) {
  try {
    const siteKey = await getSiteKey();
    if (!siteKey) return "";
    await loadScript(siteKey);
    return await window.grecaptcha.execute(siteKey, { action });
  } catch (_) {
    return "";
  }
}
