import { getCaptchaToken } from "../recaptcha.js";

function byId(id) { return document.getElementById(id); }

function setStatus(message, tone = "info") {
  const el = byId("verify-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function isMobile(identifier) {
  const stripped = String(identifier || "").replace(/[\s\-()]/g, "");
  if (stripped.includes("@")) return false;
  return /^\+?\d{7,15}$/.test(stripped);
}

function formatIdentifierHint(identifier) {
  if (isMobile(identifier)) {
    const digits = identifier.replace(/\D/g, "");
    const masked = "x".repeat(Math.max(digits.length - 4, 2)) + digits.slice(-4);
    return `your mobile number ending with ${masked}`;
  }
  return identifier;
}

const identifier = sessionStorage.getItem("pt_otp_identifier");

if (!identifier) {
  window.location.href = "/owner";
} else {
  const title = byId("verify-title");
  const sub = byId("verify-sub");
  if (isMobile(identifier)) {
    if (title) title.textContent = "Check your phone";
  }
  if (sub) sub.textContent = `We sent a 6-digit code to ${formatIdentifierHint(identifier)}.`;
}

async function verify() {
  const code = byId("verify-code")?.value?.trim();
  if (!code || code.length !== 6) {
    setStatus("Please enter the 6-digit code.", "error");
    return;
  }
  const btn = byId("verify-button");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    const result = await fetchJson("/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, code })
    });
    sessionStorage.removeItem("pt_otp_identifier");
    sessionStorage.setItem("pt_is_new_user", result.isNewUser ? "1" : "0");
    if (result.isNewUser) {
      document.querySelector(".pt-form").style.display = "none";
      byId("verify-status").textContent = "";
      byId("set-password-step").style.display = "";
      byId("set-password-inp").focus();
      return;
    }
    window.location.href = "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Verification failed", "error");
  }
}

async function resend() {
  if (!identifier) return;
  const btn = byId("resend-button");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    const recaptchaToken = await getCaptchaToken("send_otp");
    await fetchJson("/api/auth/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, recaptchaToken })
    });
    setStatus("A new code has been sent.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to resend", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
  }
}

// The "Sign in using PIN" path off the verification screen: the owner already
// knows their credential and does not want to wait for the code.
//
// One field, either credential — the login PIN, or the password on an account
// that predates PINs. The gate is entirely server-side: /api/auth/login checks
// the submitted value against the stored hashes and answers "Invalid
// credentials" for anything else, so nothing here decides whether to let anyone
// in. See routes/auth/credentials.js.
async function loginWithPassword() {
  const secret = byId("password-inp")?.value?.trim();
  if (!identifier) { setStatus("Session expired. Please go back and sign in again.", "error"); return; }
  if (!secret) { setStatus("Enter your PIN.", "error"); return; }
  const btn = byId("password-login-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `identifier`, not `email`. This posted the typed value as `email` and
      // the server resolved it as one, so somebody who reached this screen by
      // asking for a code on their PHONE could never sign in here — their
      // number matched no address and the answer was always "Invalid
      // credentials". The endpoint still accepts the old names from a cached
      // client; these are the ones that work for a number as well.
      body: JSON.stringify({ identifier, pin: secret })
    });
    sessionStorage.removeItem("pt_otp_identifier");
    window.location.href = "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Sign in failed.", "error");
  }
}

async function setPassword() {
  const password = byId("set-password-inp")?.value?.trim();
  if (!password || password.length < 8) { setStatus("Password must be at least 8 characters.", "error"); return; }
  const btn = byId("set-password-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    await fetchJson("/api/owner/set-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    });
    window.location.href = "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Failed to set password.", "error");
  }
}

byId("verify-button")?.addEventListener("click", verify);
byId("resend-button")?.addEventListener("click", resend);
byId("verify-code")?.addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });

byId("use-password-btn")?.addEventListener("click", () => {
  document.querySelector(".pt-form").style.display = "none";
  byId("use-password-row").style.display = "none";
  byId("password-step").style.display = "";
  byId("password-inp").focus();
  setStatus("", "info");
});
byId("password-login-btn")?.addEventListener("click", loginWithPassword);
byId("password-inp")?.addEventListener("keydown", (e) => { if (e.key === "Enter") loginWithPassword(); });
byId("set-password-btn")?.addEventListener("click", setPassword);
byId("set-password-inp")?.addEventListener("keydown", (e) => { if (e.key === "Enter") setPassword(); });
byId("skip-password-btn")?.addEventListener("click", () => { window.location.href = "/owner-welcome"; });
