function byId(id) {
  return document.getElementById(id);
}

function setStatus(message, tone = "info") {
  const el = byId("reset-status");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone;
}

function getTokenFromUrl() {
  return new URLSearchParams(window.location.search).get("token") || "";
}

async function handleResetPassword() {
  const token = getTokenFromUrl();
  const password = byId("reset-password")?.value;
  const confirm = byId("reset-password-confirm")?.value;

  if (!token) {
    byId("reset-form-shell").hidden = true;
    byId("reset-invalid-shell").hidden = false;
    return;
  }

  if (!password) {
    setStatus("Enter a new password.", "error");
    return;
  }

  if (password.length < 8) {
    setStatus("Password must be at least 8 characters.", "error");
    return;
  }

  if (password !== confirm) {
    setStatus("Passwords do not match.", "error");
    return;
  }

  const btn = byId("reset-submit");
  if (btn) { btn.disabled = true; btn.textContent = "Updating..."; }
  setStatus("", "info");

  try {
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password })
    });

    const data = await response.json();

    if (!response.ok) {
      if (btn) { btn.disabled = false; btn.textContent = "Update password"; }
      setStatus(data.error || "Failed to reset password.", "error");

      if (data.error?.includes("expired") || data.error?.includes("Invalid")) {
        byId("reset-form-shell").hidden = true;
        byId("reset-invalid-shell").hidden = false;
      }
      return;
    }

    byId("reset-form-shell").hidden = true;
    byId("reset-success-shell").hidden = false;
  } catch {
    if (btn) { btn.disabled = false; btn.textContent = "Update password"; }
    setStatus("Something went wrong. Please try again.", "error");
  }
}

// Show invalid state immediately if no token in URL
if (!getTokenFromUrl()) {
  byId("reset-form-shell").hidden = true;
  byId("reset-invalid-shell").hidden = false;
}

byId("reset-submit")?.addEventListener("click", handleResetPassword);
