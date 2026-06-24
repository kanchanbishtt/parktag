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
    await fetchJson("/api/auth/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier })
    });
    setStatus("A new code has been sent.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to resend", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
  }
}

byId("verify-button")?.addEventListener("click", verify);
byId("resend-button")?.addEventListener("click", resend);

byId("verify-code")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verify();
});
