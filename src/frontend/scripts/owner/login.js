import { getCaptchaToken } from "../recaptcha.js";
import { getFirebaseCaptchaToken } from "../firebase-sms.js";

// Remember that this visitor arrived here on their way to the shop (/shop sends
// signed-out buyers to /owner-login?next=shop), so the dashboard can open the
// Shop tab for them once they are signed in.
//
// sessionStorage rather than carrying a ?next through the redirects: signing in
// can take several hops off this page — the email OTP screen, the Google OAuth
// round trip — and each one arrives on a URL we do not control, so a query
// string would be dropped somewhere along the way. It is also tab-scoped, so
// the intent cannot leak into the visitor's other tabs. The dashboard deletes
// the key as it reads it, the same hand-off pt_is_new_user already uses.
const _q = new URLSearchParams(location.search);
if (_q.get("next") === "shop") {
  sessionStorage.setItem("pt_after_login", "shop");

  // And WHICH pack they picked, when they came from the public storefront.
  // Parked alongside the intent and for the same reason: sign-in can take
  // several hops through pages we do not control, and a query string would be
  // dropped on one of them. /shop has already checked this against the
  // catalogue, so what is stored is a real product id or nothing.
  const sku = _q.get("sku");
  if (sku) sessionStorage.setItem("pt_after_login_sku", sku);
  else sessionStorage.removeItem("pt_after_login_sku");
}

// The same parking mechanism, for the WhatsApp alert deep link.
//
// /v/:tagId sends a signed-out owner here. They arrived from a message saying
// somebody is standing at their car, and they have ten minutes to call that
// person back, so dropping them on a generic dashboard after sign-in wastes
// the only thing the message was for.
//
// A raw path is deliberately NOT stored. Reading a "where to go next" string
// out of a URL and later assigning it to location.href is an open redirect,
// and this page is linked from messages. Only the tag id travels, and the
// destination is rebuilt from it.
if (_q.get("next") === "vehicle") {
  sessionStorage.setItem("pt_after_login", "vehicle");
  const tag = _q.get("tag");
  // Hex ObjectId or nothing. Anything else cannot be one of ours, and this
  // value ends up in a URL.
  if (tag && /^[a-f0-9]{24}$/i.test(tag)) sessionStorage.setItem("pt_after_login_tag", tag);
  else sessionStorage.removeItem("pt_after_login_tag");
}

let _currentPhone = null;
let _phoneChannel = "whatsapp";
let _smsSessionInfo = null;
let _phoneBusy = false;
let _smsAvailable = false;
let _smsNextSendAt = 0;
let _smsRevealGeneration = 0;
let _smsTick = null;

// The SMS window is enforced by the server per number, for 10 minutes. This
// page mirrors it so the button can count down instead of failing on tap —
// but page memory dies on every reload, back-navigation and tab switch, and
// the person who never got their first SMS is exactly the one who reloads.
// So the window is kept in localStorage, keyed to the number it belongs to,
// and re-read whenever a number is (re)entered. Missing or blocked storage
// (private mode) degrades to the in-memory copy; the server still has the
// last word either way.
const SMS_WINDOW_MS = 10 * 60 * 1000;
const SMS_WINDOW_KEY = "pt_sms_window";
function loadSmsWindow(phone) {
  try {
    const stored = JSON.parse(localStorage.getItem(SMS_WINDOW_KEY) || "null");
    if (stored && stored.phone === phone && Number.isFinite(stored.nextSendAt) && stored.nextSendAt > Date.now()) return stored.nextSendAt;
  } catch { /* storage unavailable or corrupt: fall through */ }
  return 0;
}
function startSmsWindow(phone, ms) {
  _smsNextSendAt = Date.now() + ms;
  try { localStorage.setItem(SMS_WINDOW_KEY, JSON.stringify({ phone, nextSendAt: _smsNextSendAt })); } catch { /* best effort */ }
  refreshSmsFallback();
}
function smsWaitRemaining() {
  return Math.max(0, Math.ceil((_smsNextSendAt - Date.now()) / 1000));
}
function formatWait(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} sec`;
  return s === 0 ? `${m} min` : `${m} min ${s} sec`;
}

function resetSmsFallback() {
  _smsAvailable = false;
  _smsRevealGeneration += 1;
  if (byId("sms-consent")) byId("sms-consent").hidden = true;
  refreshSmsFallback();
}
function refreshSmsFallback() {
  if (byId("sms-fallback")) byId("sms-fallback").hidden = !_smsAvailable || !_currentPhone || _phoneChannel !== "whatsapp" || _identifierMode !== "mobile";
  const remaining = smsWaitRemaining();
  for (const id of ["sms-fallback-btn", ...(_phoneChannel === "sms" ? ["phone-resend-btn"] : [])]) {
    const btn = byId(id);
    if (!btn) continue;
    btn.disabled = _phoneBusy || remaining > 0;
    btn.textContent = remaining > 0 ? `Try SMS in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : id === "sms-fallback-btn" ? "Try SMS OTP verification" : "Resend";
  }
  // The countdown is the only thing that needs a clock: tick while it runs and
  // the tab is visible, and stop otherwise (a refresh on return catches up).
  const needsTick = remaining > 0 && !document.hidden;
  if (needsTick && !_smsTick) _smsTick = setInterval(refreshSmsFallback, 1000);
  else if (!needsTick && _smsTick) { clearInterval(_smsTick); _smsTick = null; }
}
document.addEventListener?.("visibilitychange", refreshSmsFallback);

function normalizePhoneE164(raw) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}

async function sendWhatsappOtp(raw) {
  const phone = normalizePhoneE164(raw);
  const channel = byId("phone-channel")?.value === "sms" ? "sms" : "whatsapp";
  let sessionInfo = null;
  // A number may already be inside an SMS window this page has forgotten
  // (reload, back button). Pick the later of memory and storage.
  _smsNextSendAt = Math.max(_smsNextSendAt, loadSmsWindow(phone));
  if (channel === "sms") {
    if (smsWaitRemaining() > 0) {
      refreshSmsFallback();
      throw new Error(`Please wait ${formatWait(smsWaitRemaining())} before requesting another SMS.`);
    }
    if (byId("sms-consent")) byId("sms-consent").hidden = false;
    const recaptchaToken = await getFirebaseCaptchaToken();
    let data;
    try {
      data = await fetchJson("/api/auth/firebase-phone/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, recaptchaToken })
      });
    } catch (error) {
      // The server knows the real window (it survives reloads; this page's
      // memory does not). When it says how long is left, start the countdown
      // from that so the person sees a timer, not a bare error.
      if (error?.retryAfter > 0) startSmsWindow(phone, error.retryAfter * 1000);
      throw error;
    }
    if (!data.sessionInfo) throw new Error("Could not start SMS verification. Please try again.");
    sessionInfo = data.sessionInfo;
    startSmsWindow(phone, SMS_WINDOW_MS);
  } else {
    const recaptchaToken = await getCaptchaToken("send_otp");
    await fetchJson("/api/auth/send-otp", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: phone, recaptchaToken })
    });
  }
  // Commit the channel only after a successful send. Failed resends must not
  // change which verification endpoint receives the user's current code.
  _currentPhone = phone;
  _phoneChannel = channel;
  _smsSessionInfo = sessionInfo;
  resetSmsFallback();
  if (channel === "whatsapp") {
    const generation = _smsRevealGeneration;
    setTimeout(() => {
      if (generation !== _smsRevealGeneration) return;
      _smsAvailable = true;
      refreshSmsFallback();
    }, 10000);
  }
  byId("phone-otp-inp").value = "";
  byId("phone-step2").style.display = "";
  byId("owner-form-step1").style.display = "none";
  const sub = byId("card-sub");
  if (sub) {
    const last4 = phone.replace(/\D/g, "").slice(-4);
    const masked = phone.slice(0, -4).replace(/\d/g, "X") + last4;
    sub.innerHTML = `Enter the 6-digit code sent by ${channel === "sms" ? "SMS" : "WhatsApp"} to <strong style="color:#323232;font-weight:800">${masked}</strong>.`;
    sub.style.marginBottom = "0";
  }
}

async function verifyWhatsappOtp() {
  const otp = byId("phone-otp-inp")?.value?.trim();
  if (!otp || !/^\d{6}$/.test(otp)) { setStatus("Enter the 6-digit code.", "error"); return; }
  if (_phoneBusy) return;
  _phoneBusy = true;
  const btn = byId("phone-verify-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    const data = await fetchJson(_phoneChannel === "sms" ? "/api/auth/firebase-phone/verify" : "/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(_phoneChannel === "sms"
        ? { sessionInfo: _smsSessionInfo, code: otp }
        : { identifier: _currentPhone, code: otp })
    });
    window.location.href = (data.isNewUser || data.isNew) ? "/owner-welcome?new=1" : "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Verification failed.", "error");
  } finally {
    _phoneBusy = false;
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = response.status;
    // 429s from the SMS window carry how many seconds remain.
    if (Number.isFinite(data.retryAfter) && data.retryAfter > 0) error.retryAfter = data.retryAfter;
    throw error;
  }
  return data;
}

function byId(id) { return document.getElementById(id); }
function hasEl(id) { return Boolean(byId(id)); }

function setStatus(message, tone = "info") {
  const el = byId("owner-auth-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

function detectIdentifierType(value) {
  const stripped = value.replace(/[\s\-()]/g, "");
  if (value.includes("@")) {
    // Must be user@domain.tld with real-looking domain
    return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(value.trim()) ? "email" : null;
  }
  // Indian mobile: 10 digits starting with 6-9, optionally prefixed with +91 or 0
  const digits = stripped.replace(/^\+91|^0/, "");
  if (/^[6-9]\d{9}$/.test(digits)) return "mobile";
  return null;
}

// Which identifier the form is currently offering. Mobile is the default: it is
// the identity every write path agrees on, so it is the one that reliably lands
// on the account holding the tags.
//
// Presentation only. detectIdentifierType below stays authoritative, so a
// pasted email is still accepted while the form is in mobile mode — the mode
// decides what we ASK for, never what we allow.
let _identifierMode = "mobile";

const IDENTIFIER_MODES = {
  mobile: {
    label: "Mobile number",
    placeholder: "10-digit mobile number",
    sub: "Choose WhatsApp or SMS to receive your sign-in code.",
    inputmode: "tel",
    autocomplete: "tel",
    toggle: "Use email address instead"
  },
  email: {
    label: "Email address",
    placeholder: "name@example.com",
    sub: "Enter your email address and we'll send you a verification code.",
    inputmode: "email",
    autocomplete: "username",
    toggle: "Use mobile number instead"
  }
};

function applyIdentifierMode(mode) {
  const conf = IDENTIFIER_MODES[mode];
  if (!conf) return;
  _identifierMode = mode;
  refreshSmsFallback();

  const input = byId("owner-identifier");
  const label = byId("identifier-label");
  const sub = byId("card-sub");
  const toggle = byId("identifier-mode-toggle");

  if (label) label.textContent = conf.label;
  if (sub) sub.textContent = conf.sub;
  if (toggle) toggle.textContent = conf.toggle;
  if (input) {
    input.placeholder = conf.placeholder;
    input.setAttribute("inputmode", conf.inputmode);
    input.setAttribute("autocomplete", conf.autocomplete);
  }
  updateIdentifierBadge();
}

function updateIdentifierBadge() {
  const input = byId("owner-identifier");
  const badge = byId("identifier-badge");
  if (!input || !badge) return;
  const type = detectIdentifierType(input.value.trim());
  if (type === "email") {
    badge.textContent = "EMAIL";
    badge.style.display = "";
    input.style.paddingRight = "68px";
    input.setAttribute("inputmode", "email");
  } else if (type === "mobile") {
    badge.textContent = "MOBILE";
    badge.style.display = "";
    input.style.paddingRight = "68px";
    input.setAttribute("inputmode", "tel");
  } else {
    badge.style.display = "none";
    input.style.paddingRight = "";
    // Back to whatever this mode asks for, NOT a hardcoded email keypad —
    // clearing a half-typed number used to hand mobile users a QWERTY layout.
    input.setAttribute("inputmode", IDENTIFIER_MODES[_identifierMode].inputmode);
  }
}

async function loginOwner() {
  if (_phoneBusy) return;
  const raw = byId("owner-identifier")?.value?.trim();
  if (!raw) {
    setStatus(
      _identifierMode === "email"
        ? "Please enter your email address."
        : "Please enter your mobile number.",
      "error"
    );
    return;
  }
  const type = detectIdentifierType(raw);
  if (!type) {
    if (raw.includes("@")) {
      setStatus("Invalid email address. Please check and try again.", "error");
    } else {
      setStatus("Invalid phone number. Enter a 10-digit Indian mobile number.", "error");
    }
    return;
  }
  const btn = byId("owner-login-button");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }

  if (type === "mobile") {
    _phoneBusy = true;
    try {
      await sendWhatsappOtp(raw);
    } catch (error) {
      if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
      // A failed send must not hide the SMS fallback. Keep the entered
      // number, open the verification step, and offer SMS (with its countdown,
      // if this number is inside a window) right away.
      const attempted = byId("phone-channel")?.value === "sms" ? "sms" : "whatsapp";
      _currentPhone = normalizePhoneE164(raw);
      _phoneChannel = "whatsapp";
      _smsAvailable = true;
      _smsNextSendAt = Math.max(_smsNextSendAt, loadSmsWindow(_currentPhone));
      byId("phone-step2").style.display = "";
      byId("owner-form-step1").style.display = "none";
      refreshSmsFallback();
      // Name the channel that actually failed: an SMS refusal (typically the
      // 10-minute window) must not be reported as a WhatsApp failure.
      setStatus(
        attempted === "sms"
          ? (error instanceof Error && error.message ? error.message : "Could not send SMS. Please try again.")
          : "WhatsApp could not send the code. Please try SMS below.",
        "error"
      );
    } finally {
      _phoneBusy = false;
    }
    return;
  }

  try {
    const recaptchaToken = await getCaptchaToken("send_otp");
    await fetchJson("/api/auth/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: raw, recaptchaToken })
    });
    sessionStorage.setItem("pt_otp_identifier", raw);
    window.location.href = "/owner-verify";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Failed to send code", "error");
  }
}

async function resendWhatsappOtp() {
  if (!_currentPhone || _phoneBusy) return;
  _phoneBusy = true;
  const btn = byId("phone-resend-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    // Resend through the channel on which this challenge was issued.
    if (byId("phone-channel")) byId("phone-channel").value = _phoneChannel;
    await sendWhatsappOtp(_currentPhone);
    setStatus(`A new code has been sent by ${_phoneChannel === "sms" ? "SMS" : "WhatsApp"}.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to resend code.", "error");
  } finally {
    _phoneBusy = false;
    if (btn) btn.classList.remove("pt-btn-loading");
    // Do not blindly re-enable: on the SMS channel the button is the
    // countdown, and it must stay disabled until the window has passed.
    // refreshSmsFallback owns its state there; WhatsApp has no cooldown.
    if (_phoneChannel === "sms") refreshSmsFallback();
    else if (btn) btn.disabled = false;
  }
}

// One field, either credential — a login PIN or, for accounts that predate
// them, a password. The server decides which it matched and never says, because
// answering "this account has a PIN" to an unauthenticated caller is the same
// account-enumeration signal the rest of the sign-in path withholds.
async function loginWithPassword() {
  const identifier = _currentPhone;
  const secret = byId("password-inp")?.value?.trim();
  if (!identifier) { setStatus("Please go back and enter your email or mobile.", "error"); return; }
  if (!secret) { setStatus("Enter your PIN.", "error"); return; }
  const btn = byId("password-login-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `identifier`, not `email`. This step used to post the value as `email`
      // and the server resolved it as one, so an owner who registered by phone
      // could never authenticate here — their number matched no address and the
      // answer was always "Invalid credentials". The endpoint still accepts the
      // old names from a cached client; this sends the ones that work for both.
      body: JSON.stringify({ identifier, pin: secret })
    });
    window.location.href = "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Sign in failed.", "error");
  }
}

// Show error from Google OAuth redirect (e.g. ?error=google_cancelled)
const urlError = new URLSearchParams(location.search).get("error");
if (urlError && hasEl("owner-auth-status")) {
  const messages = {
    google_cancelled: "Google sign-in was cancelled.",
    auth_failed: "Google sign-in failed. Please try again.",
    no_email: "Google account has no email address.",
    email_unverified: "Your Google email isn't verified. Verify it with Google, then try again.",
    no_account: "No ParkTag account found for this Google account. Please register first.",
    invalid_state: "Security check failed (state mismatch). Please try again.",
    token_exchange_failed: "Failed to exchange token with Google. Please try again.",
    userinfo_failed: "Failed to get user info from Google. Please try again.",
    db_unavailable: "Database unavailable. Please try again later.",
  };
  // Only ever render one of the messages above. The previous fallback echoed
  // the raw ?error= value, which let anyone put their own words on the real
  // sign-in page of the real domain — "Your account is locked, call
  // +91 …" reads as genuine there in a way it never could elsewhere. It went
  // through textContent so it was not script injection, but a phishing lure
  // hosted on your own login page is the part that matters.
  setStatus(messages[urlError] || "Sign-in failed. Please try again.", "error");
}

if (hasEl("owner-identifier")) {
  // Mobile first. Set from script rather than trusting the markup so the two
  // cannot drift apart.
  applyIdentifierMode("mobile");

  byId("owner-identifier").addEventListener("input", () => {
    // Somebody typing an "@" while the form is asking for a number is telling
    // us which identifier they have. Follow them instead of making them find
    // the toggle first — a dead end here is how people end up creating a
    // second account rather than signing in to the one they already have.
    if (_identifierMode === "mobile" && byId("owner-identifier").value.includes("@")) {
      applyIdentifierMode("email");
    }
    updateIdentifierBadge();
    setStatus("", "info");
  });
  byId("owner-identifier").addEventListener("keydown", (e) => { if (e.key === "Enter") loginOwner(); });
}
if (hasEl("identifier-mode-toggle")) {
  byId("identifier-mode-toggle").addEventListener("click", () => {
    if (_phoneBusy) return;
    applyIdentifierMode(_identifierMode === "mobile" ? "email" : "mobile");
    setStatus("", "info");
    const input = byId("owner-identifier");
    if (input) { input.value = ""; input.focus(); }
  });
}
if (hasEl("owner-login-button")) byId("owner-login-button").addEventListener("click", loginOwner);
if (hasEl("phone-verify-btn")) byId("phone-verify-btn").addEventListener("click", verifyWhatsappOtp);
if (hasEl("phone-otp-inp")) byId("phone-otp-inp").addEventListener("keydown", e => { if (e.key === "Enter") verifyWhatsappOtp(); });
if (hasEl("phone-resend-btn")) byId("phone-resend-btn").addEventListener("click", resendWhatsappOtp);
if (hasEl("phone-back-btn")) {
  byId("phone-back-btn").addEventListener("click", e => {
    e.preventDefault();
    if (_phoneBusy) return;
    _smsSessionInfo = null;
    _currentPhone = null;
    resetSmsFallback();
    byId("phone-channel").value = "whatsapp";
    byId("phone-step2").style.display = "none";
    byId("owner-form-step1").style.display = "";
    setStatus("", "info");
    const btn = byId("owner-login-button");
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    // Restore the prompt for whichever identifier the form is offering, rather
    // than a fixed line that would contradict the label right below it.
    const sub = byId("card-sub");
    if (sub) sub.style.marginBottom = "20px";
    applyIdentifierMode(_identifierMode);
  });
}
if (hasEl("use-password-btn")) {
  byId("use-password-btn").addEventListener("click", () => {
    if (_phoneBusy) return;
    byId("phone-step2").style.display = "none";
    byId("password-step").style.display = "";
    byId("password-inp").focus();
    setStatus("", "info");
  });
}
if (hasEl("password-login-btn")) byId("password-login-btn").addEventListener("click", loginWithPassword);
if (hasEl("password-inp")) byId("password-inp").addEventListener("keydown", e => { if (e.key === "Enter") loginWithPassword(); });
if (hasEl("password-back-btn")) {
  byId("password-back-btn").addEventListener("click", e => {
    e.preventDefault();
    byId("password-step").style.display = "none";
    byId("phone-step2").style.display = "";
    byId("password-inp").value = "";
    setStatus("", "info");
  });
}

if (hasEl("sms-fallback-btn")) {
  refreshSmsFallback();
  byId("sms-fallback-btn").addEventListener("click", async () => {
    if (!_smsAvailable || _phoneBusy || Date.now() < _smsNextSendAt) return;
    byId("phone-channel").value = "sms";
    if (!_currentPhone) { await loginOwner(); refreshSmsFallback(); return; }
    _phoneBusy = true;
    refreshSmsFallback();
    try {
      await sendWhatsappOtp(_currentPhone);
      setStatus("An SMS verification code has been sent.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not send SMS.", "error");
    } finally { _phoneBusy = false; refreshSmsFallback(); }
  });
}
