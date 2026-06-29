function byId(id) {
  return document.getElementById(id);
}

function setStatus(message, tone = "info") {
  const el = byId("forgot-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

async function handleForgotPassword() {
  const email = byId("forgot-email")?.value.trim();

  if (!email) {
    setStatus("Enter your email address first.", "error");
    return;
  }

  const btn = byId("forgot-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
  setStatus("", "info");

  try {
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });

    await response.json();

    // Always show success — never reveal if the email exists or not
    byId("forgot-form-shell").hidden = true;
    byId("forgot-success-shell").hidden = false;
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = "Send reset link"; }
    setStatus("Something went wrong. Please try again.", "error");
  }
}

byId("forgot-submit")?.addEventListener("click", handleForgotPassword);

byId("forgot-email")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleForgotPassword();
});
