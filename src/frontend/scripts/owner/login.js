
let _currentPhone = null;

// HTML-escape any value before interpolating it into innerHTML. tag.plateNumber
// / tag.vehicleLabel are owner-supplied free text with no character allowlist
// on the backend, so an unescaped value would execute as HTML/script here.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizePhoneE164(raw) {
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return digits;
}

async function sendWhatsappOtp(raw) {
  const phone = normalizePhoneE164(raw);
  _currentPhone = phone;

  await fetchJson("/api/auth/send-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: phone })
  });

  byId("phone-step2").style.display = "";
  byId("owner-form-step1").style.display = "none";
  byId("google-section").style.display = "none";
  const sub = byId("card-sub");
  if (sub) {
    const last4 = phone.replace(/\D/g, "").slice(-4);
    const masked = phone.slice(0, -4).replace(/\d/g, "X") + last4;
    sub.innerHTML = `Enter the 6-digit code sent to your WhatsApp <strong style="color:#323232;font-weight:800">${masked}</strong>.`;
    sub.style.marginBottom = "0";
  }
}

async function verifyWhatsappOtp() {
  const otp = byId("phone-otp-inp")?.value?.trim();
  if (!otp || otp.length !== 6) { setStatus("Enter the 6-digit code.", "error"); return; }
  const btn = byId("phone-verify-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    const data = await fetchJson("/api/auth/verify-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: _currentPhone, code: otp })
    });
    window.location.href = data.isNewUser ? "/owner-welcome?new=1" : "/owner-welcome";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Verification failed.", "error");
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
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

function renderDashboard(data) {
  const { owner, tags, requests } = data;

  // Header name/email in drawer
  const menuName = byId("menu-owner-name");
  const menuEmail = byId("menu-owner-email");
  if (menuName) menuName.textContent = owner.displayName;
  if (menuEmail) menuEmail.textContent = owner.email;

  // Show active badge if any tag is active
  const hasActive = tags.some(t => t.status === "active");
  const badge = byId("owner-active-badge");
  if (badge) badge.hidden = !hasActive;

  // QR card — show first tag's QR
  const qrWrap = byId("owner-qr-wrap");
  if (qrWrap) {
    if (tags.length && tags[0].qrDataUrl) {
      qrWrap.innerHTML = `<img src="${tags[0].qrDataUrl}" alt="Your ParkTag QR" class="pt-qr-image" />`;
    } else {
      qrWrap.innerHTML = `<p class="pt-empty-hint">No QR available yet.</p>`;
    }
  }

  // Vehicle details — first tag
  const details = byId("owner-vehicle-details");
  if (details) {
    if (!tags.length) {
      details.innerHTML = `<p class="pt-empty-hint">No tags linked yet. <a href="/register-owner" style="color:var(--pt-amber);font-weight:700">Register a tag</a>.</p>`;
    } else {
      details.innerHTML = tags.map(tag => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pt-border)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="2" y="8" width="20" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 8l2-4h10l2 4" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="18" r="1.5" fill="currentColor"/><circle cx="17" cy="18" r="1.5" fill="currentColor"/></svg>
          <span style="font-weight:600">Plate Number</span>
          <span style="margin-left:auto;font-weight:800;letter-spacing:0.06em">${esc(tag.plateNumber || "—")}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pt-border)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" stroke-width="2"/><path d="M14 14h2v2h-2zM18 14h3M14 18v3M18 18h3v3h-3z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span style="font-weight:600">Tag ID</span>
          <span style="margin-left:auto;font-weight:700;font-size:0.85rem">${tag.token}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--pt-border)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span style="font-weight:600">Vehicle Nickname</span>
          <span style="margin-left:auto;font-weight:700">${esc(tag.vehicleLabel || "—")}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <span style="font-weight:600">Status</span>
          <span style="margin-left:auto;font-weight:700;color:${tag.status === 'active' ? '#FF2700' : '#6B7280'}">${tag.status}</span>
        </div>
        ${tag.printStatus === "pending_print" || tag.printStatus === "printed" ? `
        <div style="margin-top:8px">
          <span style="font-size:0.78rem;font-weight:700;background:${tag.printStatus === 'printed' ? '#FFF2EF' : '#FFE3DD'};color:${tag.printStatus === 'printed' ? '#FF2700' : '#FF2700'};padding:4px 10px;border-radius:20px">
            ${tag.printStatus === "printed" ? "Sticker printed" : "Sticker order placed"}
          </span>
        </div>` : `
        <button class="pt-btn" id="sticker-btn-${tag.id}" onclick="requestSticker('${tag.id}', '${tag.token}')"
          style="margin-top:10px;background:#F3F4F6;color:var(--pt-ink);border:1.5px solid var(--pt-border);border-radius:10px;padding:9px 14px;font-size:0.85rem;font-weight:700;cursor:pointer;width:100%;font-family:inherit">
          Request printed sticker
        </button>`}
      `).join('<div style="height:16px"></div>');
    }
  }

  // Tag select + controls
  const select = byId("owner-tag-select");
  const controls = byId("owner-tag-controls");
  if (select && tags.length > 0) {
    select.innerHTML = tags.map(t =>
      `<option value="${t.id}">${esc(t.vehicleLabel || "Vehicle")} · ${esc(t.status)}</option>`
    ).join("");
    if (controls) controls.hidden = false;
  }

  // Recent requests
  const reqList = byId("owner-requests-list");
  if (reqList) {
    if (!requests.length) {
      reqList.innerHTML = `<p class="pt-empty-hint">No contact requests yet.</p>`;
    } else {
      const ownerMobile = owner.mobile || null;
      const now = Date.now();
      const SIXTY_MIN = 60 * 60 * 1000;

      reqList.innerHTML = requests.map((r, idx) => {
        const channel = r.action === "message"
          ? (r.messageChannel === "whatsapp" ? "WhatsApp" : "SMS")
          : "Call";
        const withinWindow = r.action === "call" && r.phone &&
          (now - new Date(r.createdAt).getTime()) < SIXTY_MIN;
        const callBackBtn = (r.action === "call" && r.phone) ? `
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button data-callback="${idx}"
              style="font-size:0.78rem;padding:5px 12px;background:#FFE3DD;color:#FF2700;
                     border:none;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;
                     opacity:${withinWindow ? "1" : "0.45"}">
              📞 Call Back
            </button>
            <span data-callback-status style="font-size:0.75rem;color:var(--pt-sub)">
              ${withinWindow ? "" : "60-min window closed"}
            </span>
          </div>` : "";
        return `
          <div style="padding:12px 0;border-bottom:1px solid var(--pt-border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-weight:700;font-size:0.9rem">${channel} request</span>
              <span style="font-size:0.75rem;color:var(--pt-sub)">${new Date(r.createdAt).toLocaleDateString()}</span>
            </div>
            ${r.message ? `<p style="font-size:0.85rem;color:var(--pt-sub);margin:0">"${esc(r.message)}"</p>` : ""}
            <span style="font-size:0.75rem;color:var(--pt-sub)">Status: ${r.status}</span>
            ${callBackBtn}
          </div>`;
      }).join("");

      // Event delegation — single listener handles all Call Back buttons.
      reqList.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-callback]");
        if (!btn) return;

        const statusEl = btn.parentElement.querySelector("[data-callback-status]");

        if (!ownerMobile) {
          if (statusEl) statusEl.textContent = "Add your phone number in profile settings to enable callback.";
          return;
        }

        btn.disabled = true;
        btn.textContent = "Connecting…";
        if (statusEl) statusEl.textContent = "";

        try {
          const res = await fetch("/api/owner/callback/register-call", { method: "POST" });
          const data = await res.json().catch(() => ({}));

          if (res.status === 410) {
            btn.disabled = false;
            btn.textContent = "📞 Call Back";
            if (statusEl) statusEl.textContent = "Window expired. No recent contact within 60 min.";
            return;
          }
          if (res.status === 402) {
            btn.disabled = false;
            btn.textContent = "📞 Call Back";
            if (statusEl) statusEl.textContent = "Add your phone number to enable callback.";
            return;
          }
          if (!res.ok) throw new Error(data.error || "Could not start callback.");

          const virtualNumber = data.virtualNumber || "";
          if (virtualNumber) {
            window.location.href = `tel:${virtualNumber}`;
            btn.disabled = false;
            btn.textContent = "Tap to Call";
            btn.onclick = () => { window.location.href = `tel:${virtualNumber}`; };
            if (statusEl) statusEl.textContent = virtualNumber;
          }
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "📞 Call Back";
          if (statusEl) statusEl.textContent = err instanceof Error ? err.message : "Could not start callback.";
        }
      });
    }
  }
}

async function loadOwnerDashboard() {
  try {
    const data = await fetchJson("/api/owner/dashboard");
    renderDashboard(data);
  } catch (error) {
    if (error.message.includes("Authentication required")) {
      window.location.href = "/owner";
    } else {
      setStatus(error instanceof Error ? error.message : "Failed to load dashboard", "error");
    }
  }
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
    input.setAttribute("inputmode", "email");
  }
}

async function loginOwner() {
  const raw = byId("owner-identifier")?.value?.trim();
  if (!raw) {
    setStatus("Please enter your email or mobile number.", "error");
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
    try {
      await sendWhatsappOtp(raw);
    } catch (error) {
      if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
      setStatus(error instanceof Error ? error.message : "Failed to send code.", "error");
    }
    return;
  }

  try {
    await fetchJson("/api/auth/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: raw })
    });
    sessionStorage.setItem("pt_otp_identifier", raw);
    window.location.href = "/owner-verify";
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Failed to send code", "error");
  }
}

async function resendWhatsappOtp() {
  if (!_currentPhone) return;
  const btn = byId("phone-resend-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    await fetchJson("/api/auth/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: _currentPhone })
    });
    setStatus("A new code has been sent to your WhatsApp.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to resend code.", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
  }
}

async function logoutOwner() {
  await fetchJson("/api/auth/logout", { method: "POST" });
  window.location.href = "/owner";
}

async function requestSticker(tagId, token) {
  const btn = byId(`sticker-btn-${tagId}`);
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    await fetchJson(`/api/owner/tags/${tagId}/request-sticker`, { method: "POST" });
    setStatus(`Sticker order placed for ${token}.`, "success");
    await loadOwnerDashboard();
  } catch (error) {
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    setStatus(error instanceof Error ? error.message : "Failed to place order", "error");
  }
}

window.requestSticker = requestSticker;

async function updateTagStatus(status) {
  const tagId = byId("owner-tag-select")?.value;
  if (!tagId) { setStatus("Select a tag first.", "error"); return; }
  try {
    await fetchJson(`/api/owner/tags/${tagId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    setStatus(`Tag set to ${status}.`, "success");
    await loadOwnerDashboard();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Failed to update status", "error");
  }
}

// Menu drawer toggle
function openMenu() {
  byId("owner-menu-overlay").hidden = false;
  byId("owner-menu-drawer").hidden = false;
}
function closeMenu() {
  byId("owner-menu-overlay").hidden = true;
  byId("owner-menu-drawer").hidden = true;
}

// Share QR
async function shareQr() {
  const img = document.querySelector(".pt-qr-image");
  if (!img) return;
  if (navigator.share) {
    try {
      const res = await fetch(img.src);
      const blob = await res.blob();
      const file = new File([blob], "parktag-qr.png", { type: "image/png" });
      await navigator.share({ title: "My ParkTag QR", files: [file] });
      return;
    } catch (_) {}
  }
  const a = document.createElement("a");
  a.href = img.src;
  a.download = "parktag-qr.png";
  a.click();
}

async function loginWithPassword() {
  const identifier = _currentPhone;
  const password = byId("password-inp")?.value?.trim();
  if (!identifier) { setStatus("Please go back and enter your email or mobile.", "error"); return; }
  if (!password) { setStatus("Enter your password.", "error"); return; }
  const btn = byId("password-login-btn");
  if (btn) { btn.disabled = true; btn.classList.add("pt-btn-loading"); }
  try {
    const rememberMe = document.getElementById("remember-me")?.checked || false;
    await fetchJson("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "owner", email: identifier, password, rememberMe })
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
    no_account: "No ParkTag account found for this Google account. Please register first.",
    invalid_state: "Security check failed (state mismatch). Please try again.",
    token_exchange_failed: "Failed to exchange token with Google. Please try again.",
    userinfo_failed: "Failed to get user info from Google. Please try again.",
    db_unavailable: "Database unavailable. Please try again later.",
  };
  setStatus(messages[urlError] || `Error: ${urlError}. Please try again.`, "error");
}

if (hasEl("owner-identifier")) {
  byId("owner-identifier").addEventListener("input", () => {
    updateIdentifierBadge();
    setStatus("", "info");
  });
  byId("owner-identifier").addEventListener("keydown", (e) => { if (e.key === "Enter") loginOwner(); });
}
if (hasEl("owner-login-button")) byId("owner-login-button").addEventListener("click", loginOwner);
if (hasEl("phone-verify-btn")) byId("phone-verify-btn").addEventListener("click", verifyWhatsappOtp);
if (hasEl("phone-otp-inp")) byId("phone-otp-inp").addEventListener("keydown", e => { if (e.key === "Enter") verifyWhatsappOtp(); });
if (hasEl("phone-resend-btn")) byId("phone-resend-btn").addEventListener("click", resendWhatsappOtp);
if (hasEl("phone-back-btn")) {
  byId("phone-back-btn").addEventListener("click", e => {
    e.preventDefault();
    byId("phone-step2").style.display = "none";
    byId("owner-form-step1").style.display = "";
    byId("google-section").style.display = "";
    setStatus("", "info");
    const btn = byId("owner-login-button");
    if (btn) { btn.disabled = false; btn.classList.remove("pt-btn-loading"); }
    const sub = byId("card-sub");
    if (sub) { sub.innerHTML = "Enter your email or mobile number and we'll send you a verification code."; sub.style.marginBottom = "20px"; }
  });
}
if (hasEl("use-password-btn")) {
  byId("use-password-btn").addEventListener("click", () => {
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
if (hasEl("owner-logout-button")) byId("owner-logout-button").addEventListener("click", logoutOwner);
if (hasEl("owner-set-active")) byId("owner-set-active").addEventListener("click", () => updateTagStatus("active"));
if (hasEl("owner-set-inactive")) byId("owner-set-inactive").addEventListener("click", () => updateTagStatus("inactive"));
if (hasEl("owner-menu-btn")) byId("owner-menu-btn").addEventListener("click", openMenu);
if (hasEl("owner-menu-close")) byId("owner-menu-close").addEventListener("click", closeMenu);
if (hasEl("owner-menu-overlay")) byId("owner-menu-overlay").addEventListener("click", closeMenu);
if (hasEl("share-qr-btn")) byId("share-qr-btn").addEventListener("click", shareQr);
if (hasEl("owner-done-btn")) byId("owner-done-btn").addEventListener("click", () => window.location.href = "/");

if (hasEl("owner-vehicle-details")) {
  await loadOwnerDashboard();
}
