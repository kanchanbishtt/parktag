// ── Login PIN screen ───────────────────────────────────────────────────────
//
// Sets, changes and removes the PIN that signs an owner in, and ends sessions
// on other devices.
//
// Every control is wired with addEventListener and nothing is an onclick
// attribute. /owner-login-pin is in STRICT_SCRIPT_PAGES (see app.js), so its
// CSP drops 'unsafe-inline' from BOTH script-src and script-src-attr: an inline
// handler here would not fail loudly, it would silently never fire. A page that
// manages a credential is exactly the page that should be on the strict policy,
// so the rule is kept and the handlers come from here.
//
// The server decides everything that matters. The checks in this file exist to
// answer in the same keystroke rather than a round trip later — every one of
// them is repeated in routes/owner/login-pin.js, which is the copy that counts.

const MIN_DIGITS = 6;
const MAX_DIGITS = 8;

const ICON_EYE =
  '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.8"/></svg>';
const ICON_EYE_OFF =
  '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.3 4M6.5 7.9A17 17 0 0 0 2.5 12S6 18.2 12 18.2c1.2 0 2.3-.2 3.3-.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.8 9.9a3.1 3.1 0 0 0 4.3 4.3" stroke="currentColor" stroke-width="1.8"/></svg>';

const byId = (id) => document.getElementById(id);

const els = {
  skel: byId("lp-skel"),
  body: byId("lp-body"),
  cardTitle: byId("lp-card-title"),
  cardSub: byId("lp-card-sub"),
  banner: byId("lp-banner"),
  bannerText: byId("lp-banner-text"),
  currentWrap: byId("lp-current-wrap"),
  current: byId("lp-current"),
  newLabel: byId("lp-new-label"),
  newPin: byId("lp-new"),
  newCount: byId("lp-new-count"),
  confirm: byId("lp-confirm"),
  confirmCount: byId("lp-confirm-count"),
  save: byId("lp-save"),
  remove: byId("lp-remove"),
  msg: byId("lp-msg"),
  revoke: byId("lp-revoke"),
  revokeMsg: byId("lp-revoke-msg")
};

let hasPin = false;

// ── Plumbing ───────────────────────────────────────────────────────────────

async function api(path, options) {
  const res = await fetch(path, {
    // Without this the cookie does not travel and every call is a 401. Explicit
    // rather than relying on the default, which differs across browsers for
    // requests this file may later be asked to make cross-origin.
    credentials: "same-origin",
    cache: "no-store",
    ...(options || {})
  });

  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  return { status: res.status, data };
}

function post(path, body, method = "POST") {
  return api(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  });
}

function setMsg(el, text, kind) {
  el.textContent = text || "";
  el.className = `lp-msg${text ? ` on ${kind || "error"}` : ""}`;
}

// A 401 here means the session went away between loading the page and pressing
// the button — an expiry, or a sign-out in another tab. Sending them to the
// sign-in page is the only useful answer; showing "unauthorised" on a settings
// screen is a dead end.
function bounceIfSignedOut(status) {
  if (status !== 401) return false;
  window.location.href = "/owner-login";
  return true;
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render() {
  els.cardTitle.textContent = hasPin ? "Change Login PIN" : "Setup Login PIN";
  els.cardSub.textContent = hasPin
    ? "Update the PIN you sign in with"
    : "Secure your account with a login PIN";

  els.banner.className = `lp-banner ${hasPin ? "ok" : "info"}`;
  els.bannerText.textContent = hasPin
    ? "Your login PIN is active"
    : "You have not set a login PIN yet";

  els.currentWrap.hidden = !hasPin;
  els.newLabel.textContent = hasPin ? "New PIN" : "Setup Login PIN";
  els.save.textContent = hasPin ? "Update PIN" : "Setup PIN";
  els.remove.hidden = !hasPin;
}

function clearFields() {
  for (const input of [els.current, els.newPin, els.confirm]) {
    input.value = "";
    input.classList.remove("bad");
  }
  updateCounts();
}

function updateCounts() {
  els.newCount.textContent = `${els.newPin.value.length}/${MAX_DIGITS}`;
  els.confirmCount.textContent = `${els.confirm.value.length}/${MAX_DIGITS}`;
}

// ── Input behaviour ────────────────────────────────────────────────────────

// Digits only, whatever the source. `maxlength` and inputmode="numeric" are
// hints a keyboard offers rather than rules it enforces: a paste, a desktop
// keyboard, or an Android IME suggestion all put letters in this field
// otherwise, and the failure would then arrive from the server as a validation
// error about something the owner cannot see they typed.
function bindDigits(input) {
  input.addEventListener("input", () => {
    const cleaned = input.value.replace(/\D/g, "").slice(0, MAX_DIGITS);
    if (cleaned !== input.value) input.value = cleaned;
    input.classList.remove("bad");
    updateCounts();
  });
}

function bindEye(button) {
  const input = byId(button.dataset.eye);
  if (!input) return;

  button.innerHTML = ICON_EYE_OFF;

  button.addEventListener("click", () => {
    const revealing = input.type === "password";
    input.type = revealing ? "text" : "password";
    button.innerHTML = revealing ? ICON_EYE : ICON_EYE_OFF;
    button.setAttribute("aria-label", revealing ? "Hide PIN" : "Show PIN");
    input.focus();
  });
}

// ── Actions ────────────────────────────────────────────────────────────────

// Mirrors isWeakLoginPin in lib/auth/login-pin.js so the answer arrives while
// the owner is still looking at the field. The server runs the same rules plus
// one this side cannot: it also refuses digits cut out of their phone number,
// which would mean shipping that number into the page to check here.
function localWeakness(pin) {
  if (/^(\d)\1*$/.test(pin)) return true;

  for (let size = 1; size <= Math.floor(pin.length / 2); size += 1) {
    if (pin.length % size !== 0) continue;
    const block = pin.slice(0, size);
    if (pin.split(block).every((part) => part === "")) return true;
  }

  const step = Number(pin[1]) - Number(pin[0]);
  if (step === 1 || step === -1) {
    let run = true;
    for (let i = 2; i < pin.length; i += 1) {
      if (Number(pin[i]) - Number(pin[i - 1]) !== step) run = false;
    }
    if (run) return true;
  }

  return false;
}

async function save() {
  const pin = els.newPin.value;
  const confirm = els.confirm.value;
  const currentPin = els.current.value;

  setMsg(els.msg, "");

  if (hasPin && currentPin.length < 4) {
    els.current.classList.add("bad");
    setMsg(els.msg, "Enter your current PIN.");
    return;
  }

  if (pin.length < MIN_DIGITS || pin.length > MAX_DIGITS) {
    els.newPin.classList.add("bad");
    setMsg(els.msg, `PIN must be ${MIN_DIGITS} to ${MAX_DIGITS} digits.`);
    return;
  }

  if (localWeakness(pin)) {
    els.newPin.classList.add("bad");
    setMsg(
      els.msg,
      "Choose a less predictable PIN — avoid repeats like 111111 and runs like 123456."
    );
    return;
  }

  if (pin !== confirm) {
    els.confirm.classList.add("bad");
    setMsg(els.msg, "The two PINs do not match.");
    return;
  }

  els.save.disabled = true;

  try {
    const { status, data } = await post("/api/owner/login-pin", {
      pin,
      confirmPin: confirm,
      currentPin: hasPin ? currentPin : undefined
    });

    if (bounceIfSignedOut(status)) return;

    if (status !== 200 || !data.ok) {
      setMsg(els.msg, data.error || "Could not save your PIN. Please try again.");
      return;
    }

    const wasChange = hasPin;
    hasPin = true;
    render();
    clearFields();

    // Say what the change did beyond setting a PIN. Other sessions have just
    // been ended, and someone who finds themselves signed out on their laptop
    // ten minutes from now should have been told here why.
    setMsg(
      els.msg,
      data.signedOutElsewhere > 0
        ? `${wasChange ? "PIN updated" : "PIN set"}. You have been signed out on your other devices.`
        : `${wasChange ? "PIN updated." : "PIN set. You can now sign in with it."}`,
      "ok"
    );
  } catch {
    setMsg(els.msg, "Network error. Please check your connection and try again.");
  } finally {
    els.save.disabled = false;
  }
}

async function removePin() {
  const currentPin = els.current.value;
  setMsg(els.msg, "");

  if (currentPin.length < 4) {
    els.current.classList.add("bad");
    setMsg(els.msg, "Enter your current PIN to remove it.");
    return;
  }

  els.remove.disabled = true;

  try {
    const { status, data } = await post("/api/owner/login-pin", { currentPin }, "DELETE");

    if (bounceIfSignedOut(status)) return;

    if (status !== 200 || !data.ok) {
      setMsg(els.msg, data.error || "Could not remove your PIN. Please try again.");
      return;
    }

    hasPin = false;
    render();
    clearFields();
    setMsg(els.msg, "PIN removed. Sign in with a code as before.", "ok");
  } catch {
    setMsg(els.msg, "Network error. Please check your connection and try again.");
  } finally {
    els.remove.disabled = false;
  }
}

async function revokeOthers() {
  setMsg(els.revokeMsg, "");
  els.revoke.disabled = true;

  try {
    const { status, data } = await post("/api/owner/sessions/revoke-others", {});

    if (bounceIfSignedOut(status)) return;

    if (status !== 200 || !data.ok) {
      setMsg(els.revokeMsg, data.error || "Could not sign out your other devices.");
      return;
    }

    setMsg(
      els.revokeMsg,
      data.revoked > 0
        ? `Signed out of ${data.revoked} other ${data.revoked === 1 ? "session" : "sessions"}.`
        : "No other devices were signed in.",
      "ok"
    );
  } catch {
    setMsg(els.revokeMsg, "Network error. Please check your connection and try again.");
  } finally {
    els.revoke.disabled = false;
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function load() {
  try {
    const { status, data } = await api("/api/owner/login-pin");
    if (bounceIfSignedOut(status)) return;
    hasPin = Boolean(data && data.hasPin);
  } catch {
    // Show the form rather than an error page. A failed status read means the
    // page cannot say whether a PIN exists; the server still refuses a change
    // without the current PIN, so the worst case is one rejected attempt with
    // a clear message, not a wrong or dangerous action.
    hasPin = false;
  }

  render();
  els.skel.hidden = true;
  els.body.hidden = false;
}

for (const input of [els.current, els.newPin, els.confirm]) bindDigits(input);
for (const button of document.querySelectorAll("[data-eye]")) bindEye(button);

els.save.addEventListener("click", save);
els.remove.addEventListener("click", removePin);
els.revoke.addEventListener("click", revokeOthers);

// Enter submits from any of the three fields, because a numeric keypad's return
// key is the natural end of typing a PIN and hunting for the button is not.
for (const input of [els.current, els.newPin, els.confirm]) {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
  });
}

load();
