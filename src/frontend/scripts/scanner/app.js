import { getCaptchaToken } from "../recaptcha.js";

const DEFAULT_MESSAGE =
  "Hi, your vehicle is blocking my way. Please move it when possible.";

const MESSAGE_TEMPLATES = {
  blocking: DEFAULT_MESSAGE,
  lights: "Hi, your vehicle lights appear to be on. Please check your car.",
  safety: "Hi, there may be an issue with your parked vehicle. Please check it soon."
};

let actionLocked = false;
let verifiedPlateLastFour = "";
let expectedPlateLastFour = "";
let pendingAction = null;
// Which contact action the scanner asked for and is verifying the plate in
// order to reach. Plate verification is now a gate in front of a chosen
// action rather than the first thing a scanner meets, so the choice has to
// survive the detour and resume once the plate checks out.
let pendingVerifiedAction = "";
// Server-issued grant proving this scanner passed last-4 verification.
let contactGrant = "";
// Whether this E-Tag still has its free contact available (server-authoritative).
let contactAvailable = true;
// Premium tags are paid for and have no contact limit, so an action must not
// consume the scanner's only turn. Defaults to false so a tag is treated as
// one-shot unless /verify positively says otherwise — a missing or malformed
// response can never unlock an E-Tag.
let unlimitedContact = false;
// Whether the owner has set an emergency contact for this tag. The number is
// never sent to the browser — this is only a flag telling us to offer SOS.
let emergencyAvailable = false;
// Optional reason selected via the chips; the message itself is built server-side.
let selectedReason = "";

// Says "digits", not "characters": the field is `inputmode="numeric"` and the
// server matches on /^\d{4}$/, so telling someone to type letters would send
// them down a road that cannot succeed.
const PLATE_MISMATCH_MESSAGE =
  "The plate number does not match, Please check you are entering the right " +
  "plate number. You need to enter the last 4 digits of the plate number " +
  "without any space.";

// ── Activation wizard state ──────────────────────────────────────────────
// The unactivated-sticker flow is one question per step: intro → plate →
// name + mobile → WhatsApp code. Answers are collected here and only sent to
// the server on the final step, together with the OTP that authorises them.
const ACT_STEP_IDS = {
  1: "act-step-1",
  2: "act-step-2",
  3: "act-step-3",
  4: "act-step-4",
  done: "act-step-done"
};

const activation = { plate: "", name: "", phone: "" };
let resendTimer = null;
// wa.me link for the help card; empty when no support number is configured.
let supportWhatsappHref = "";

// Support number for the quick-action row. SUPPORT_WHATSAPP_NUMBER is not set
// in every environment, so this falls back to the same number the scan menu
// links to rather than leaving the row with a dead link.
const FALLBACK_SUPPORT_WHATSAPP = "918791638854";
let supportWhatsappDigits = FALLBACK_SUPPORT_WHATSAPP;
let quickStatusTimer = null;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);

  if (el) {
    el.textContent = text;
  }
}

function setHidden(id, hidden) {
  const el = byId(id);

  if (el) {
    el.hidden = hidden;
  }
}

function setValue(id, value) {
  const el = byId(id);

  if (el) {
    el.value = value;
  }
}

function setDisabled(id, disabled) {
  const el = byId(id);

  if (el) {
    el.disabled = disabled;
  }
}

function getTokenFromUrl() {
  const path = window.location.pathname;
  // Accept both /tag/<token> and the legacy /vehicle/<token>, 12–64 chars.
  const match = path.match(/\/(?:tag|vehicle)\/([A-Za-z0-9]{12,64})/);

  if (match) {
    return match[1];
  }

  const params = new URLSearchParams(window.location.search);
  return params.get("token") || "";
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function setRequestStatus(targetId, message, tone = "info") {
  const el = byId(targetId);

  if (!el) {
    return;
  }

  el.textContent = message;
  el.dataset.tone = tone;
}

function showOnly(sectionId) {
  const ids = [
    "scanner-verification-shell",
    "registration-shell",
    "scanner-action-shell",
    "error-card"
  ];

  for (const id of ids) {
    setHidden(id, id !== sectionId);
  }

  // The help card only accompanies the activation wizard, and only when a
  // support number is actually configured.
  setHidden(
    "act-help-card",
    sectionId !== "registration-shell" || !supportWhatsappHref
  );

  // The quick actions belong to a resolved tag, so they follow the action card
  // and nothing else.
  setHidden("scanner-quick-actions", sectionId !== "scanner-action-shell");

  if (sectionId !== "scanner-action-shell") {
    setHidden("quick-action-status", true);
  }
}

// ── Quick actions ────────────────────────────────────────────────────────
// Three page-level actions under the action card. Two open WhatsApp support
// with the tag already named, so a report doesn't begin with us asking "which
// tag?". None of them reaches the owner.

function supportWhatsappLink(text) {
  return `https://wa.me/${supportWhatsappDigits}?text=${encodeURIComponent(text)}`;
}

function setQuickStatus(message) {
  const el = byId("quick-action-status");

  if (!el) {
    return;
  }

  el.textContent = message;
  el.hidden = false;
  clearTimeout(quickStatusTimer);
  quickStatusTimer = setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

function setupQuickActions(tag) {
  // Only the masked plate goes into the message. It is already on screen, and
  // the full plate is something this page deliberately never learns.
  const plate = tag.maskedPlateNumber || "unknown plate";
  const urgent = byId("quick-urgent");
  const report = byId("quick-report");

  if (urgent) {
    urgent.href = supportWhatsappLink(
      `Urgent: I scanned a ParkTag on vehicle ${plate} and need help right away.\nTag: ${tag.token}`
    );
  }

  // The report goes to a form, not to WhatsApp: it needs a reason we can sort
  // on and a callback number, and it has to work for someone who does not use
  // WhatsApp. The tag travels in the query string, not the path, so the page
  // is still reachable (and says so) when opened without one.
  if (report) {
    report.href = `/report-tag?tag=${encodeURIComponent(tag.token)}`;
    report.removeAttribute("target");
    report.removeAttribute("rel");
  }
}

async function handleQuickShare() {
  const url = window.location.href;
  const payload = {
    title: "ParkTag",
    text: "Contact this vehicle's owner privately through ParkTag.",
    url
  };

  if (navigator.share) {
    try {
      await navigator.share(payload);
      return;
    } catch (error) {
      // Dismissing the sheet rejects with AbortError. That is a decision, not
      // a failure, so it must not fall through to copying the link.
      if (error && error.name === "AbortError") {
        return;
      }
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    setQuickStatus("Link copied.");
  } catch {
    setQuickStatus("Copy the link from your browser's address bar.");
  }
}

function resetActionState() {
  setHidden("message-panel", true);
  setHidden("message-editor-shell", true);
  setHidden("call-popup", true);
  setHidden("request-confirmation", true);
  setHidden("dial-panel", true);
  setHidden("contact-number-panel", true);
  setValue("message-template-select", "");
  setValue("message-text", DEFAULT_MESSAGE);
  setValue("contact-phone", "");
  actionLocked = false;
  verifiedPlateLastFour = "";
  expectedPlateLastFour = "";
  contactGrant = "";
  contactAvailable = true;
  unlimitedContact = false;
  selectedReason = "";
  pendingAction = null;
  setDisabled("call-owner-button", false);
  setDisabled("send-whatsapp-button", false);
  setDisabled("submit-message-button", false);
  setDisabled("contact-number-submit", false);
  setDisabled("final-call-button", false);
  setHidden("pt-sos-block", true);
  closeSosPanels();
  setValue("sos-phone", "");
  setDisabled("sos-final-call-button", false);
  setContactAvailability(true);
}

// Toggle between the contact buttons and the "Purchase sticker" CTA based on
// whether the free contact is still available (server-authoritative).
function setContactAvailability(available) {
  contactAvailable = available;
  setHidden("scanner-why-title", !available);
  setHidden("pt-reason-chips", !available);
  setHidden("scanner-contact-actions", !available);
  setHidden("purchase-cta", available);
  if (!available) {
    // Hide any open contact sub-panels too.
    setHidden("contact-number-panel", true);
    setHidden("dial-panel", true);
    setHidden("message-panel", true);
    setHidden("call-popup", true);
  }

  // The SOS block is gated on nothing at all. A used-up free contact must not
  // block an accident call, and neither must an owner who never nominated
  // anyone: `emergencyAvailable` now decides which screen the button leads to
  // — the owner's next of kin, or the public helplines — not whether a scanner
  // standing at a crash is offered help in the first place.
  setHidden("pt-sos-block", false);
}

// ── Emergency / SOS ──────────────────────────────────────────────────────
// Same two-step shape as the owner call (capture number → dial the masked
// virtual number), but pointed at /register-emergency-call so the Dial Whom
// webhook resolves the owner's emergency contact instead of the owner.
function closeSosPanels() {
  setHidden("sos-number-panel", true);
  setHidden("sos-dial-panel", true);
  setHidden("sos-dial-number-block", true);
}

// The SOS call rings a third party the owner nominated — someone who never
// opted in — so the tap has to be deliberate before their phone goes off. The
// gate is re-armed on every open rather than remembered for the visit: a
// confirmation that carries over is one someone made for a different tap.
function openSosConfirm() {
  const dialog = byId("sos-confirm");
  const check = byId("sos-confirm-check");

  if (check) {
    check.checked = false;
  }
  setDisabled("sos-confirm-continue", true);

  // No <dialog> support (older in-app browsers) would mean the Emergency button
  // silently does nothing, which is the worst possible failure here. Fall
  // straight through to where the gate would have sent them — the gate is a
  // deterrent, not a security control.
  if (!dialog || typeof dialog.showModal !== "function") {
    if (emergencyAvailable) {
      openSosPanel();
    }
    return;
  }

  dialog.showModal();
}

// The masked call is not available — either the owner nominated nobody, or the
// tag's daily emergency ceiling has refused it. Either way the answer is the
// public numbers, dialled directly. Nothing is registered server-side here:
// 112 is not ours to route, and a helpline must not depend on our backend
// being up.
const HELPLINE_NOTE_NO_CONTACT =
  "No emergency contact added for this tag. Use the All India helplines below.";

function openSosHelplines(note) {
  const dialog = byId("sos-helplines");

  // The note says why the helplines are being offered. It must be set every
  // time, not only when a caller passes one, or the previous reason survives
  // into a visit where it is untrue.
  setText("sos-helplines-note", note || HELPLINE_NOTE_NO_CONTACT);

  if (!dialog || typeof dialog.showModal !== "function") {
    return;
  }

  dialog.showModal();
}

function openSosPanel() {
  // Close the ordinary contact panels so only one flow is ever live.
  setHidden("contact-number-panel", true);
  setHidden("dial-panel", true);
  setHidden("message-panel", true);
  setHidden("call-popup", true);
  setHidden("request-confirmation", true);

  setHidden("sos-dial-panel", true);
  setHidden("sos-number-panel", false);
  // Take the emergency block's own place, the same way the Private Call panel
  // does. #sos-number-panel is the next sibling, so closing the block lands this
  // panel directly under the two action buttons instead of below the prompt that
  // launched it. sos-cancel puts the block back.
  setHidden("pt-sos-block", true);
  setValue("sos-phone", "");
  setRequestStatus(
    "request-status",
    "Emergency: enter your number and we will connect you to the owner's emergency contact.",
    "info"
  );
  byId("sos-phone")?.focus();
}

function handleSosNumberSubmit() {
  const phone = byId("sos-phone")?.value.trim();

  if (!phone || phone.replace(/\D/g, "").length < 7) {
    setRequestStatus("request-status", "Enter a valid phone number so we can call you back.", "error");
    return;
  }

  setHidden("sos-number-panel", true);
  setHidden("sos-dial-panel", false);
  setRequestStatus("request-status", "Tap Call Now to connect the emergency contact.", "info");
}

async function handleSosCall() {
  if (actionLocked) return;

  const token = byId("request-token")?.value.trim();
  const phone = byId("sos-phone")?.value.trim();

  if (!token || !phone) {
    setRequestStatus("request-status", "Enter your number before starting the emergency call.", "error");
    return;
  }

  actionLocked = true;
  setDisabled("sos-final-call-button", true);
  setRequestStatus("request-status", "Connecting the emergency contact…", "info");

  let virtualNumber = "";
  try {
    const res = await fetch(`/api/tags/${token}/register-emergency-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, grant: contactGrant })
    });
    const data = await res.json().catch(() => ({}));

    if (data.code === "NO_EMERGENCY_CONTACT") {
      // The owner cleared it between page load and the tap. The block stays —
      // the scanner is mid-emergency and has already confirmed — but it now
      // leads to the helplines, which is where this call has to go instead.
      emergencyAvailable = false;
      closeSosPanels();
      actionLocked = false;
      setDisabled("sos-final-call-button", false);
      setRequestStatus("request-status", "", "info");
      openSosHelplines();
      return;
    }
    if (data.code === "EMERGENCY_LIMIT") {
      // The daily ceiling has refused this masked call. The server's own message
      // already tells the scanner to ring 112 — so hand them a 112 they can
      // actually tap instead of a number to memorise. The refusal is per tag and
      // final for today, so this is not a retry the scanner can win.
      closeSosPanels();
      actionLocked = false;
      setDisabled("sos-final-call-button", false);
      setRequestStatus("request-status", "", "info");
      openSosHelplines(
        data.error ||
          "This vehicle's emergency contact has already been called several times today. Use the All India helplines below."
      );
      return;
    }
    if (!res.ok) throw new Error(data.error || "Could not start the emergency call.");
    virtualNumber = data.virtualNumber || "";
  } catch (error) {
    actionLocked = false;
    setDisabled("sos-final-call-button", false);
    setRequestStatus(
      "request-status",
      error instanceof Error ? error.message : "Could not start the emergency call.",
      "error"
    );
    return;
  }

  if (virtualNumber) {
    setText("sos-virtual-number", virtualNumber);
    setHidden("sos-dial-number-block", false);
    window.location.href = `tel:${virtualNumber}`;
  }

  // Leave a manual retry in case the dialer did not open on its own.
  const btn = byId("sos-final-call-button");
  if (btn && virtualNumber) {
    btn.disabled = false;
    btn.textContent = "Tap to Call";
    btn.onclick = () => { window.location.href = `tel:${virtualNumber}`; };
  }

  setRequestStatus("request-status", "Your phone dialer should open now.", "success");
}

function setSummaryForTag(tag) {
  const isRegistrationState = ["unclaimed", "inactive"].includes(tag.status);

  // The chip now carries one message only: this tag still needs registering.
  // An active tag no longer says "✓ Active" — the card already shows the plate
  // and its Verified badge, so the header was repeating what was on screen.
  const chip = byId("tag-chip");
  if (chip) {
    chip.textContent = isRegistrationState ? "Register to activate" : "";
    chip.dataset.tone = "warn";
    chip.hidden = !isRegistrationState;
  }

  // Populate action shell vehicle display
  const plateDisplay = byId("pt-plate-display");
  if (plateDisplay) {
    plateDisplay.textContent = tag.maskedPlateNumber || tag.vehicleLabel || "••••";
  }
  const vehicleLabel = byId("pt-vehicle-label");
  if (vehicleLabel) {
    vehicleLabel.textContent = tag.vehicleLabel || "Registered vehicle";
  }
}

async function createRequest(payload) {
  const response = await fetch("/api/contact-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Attach the verification grant so the server authorises the contact.
    body: JSON.stringify({ ...payload, grant: contactGrant })
  });
  const data = await response.json().catch(() => ({}));

  // 402 = free contact used up. Server is authoritative; flip the UI to the CTA.
  if (response.status === 402) {
    setContactAvailability(false);
    const err = new Error(data.error || "This E-Tag's free contact has been used.");
    err.freeUsed = true;
    throw err;
  }
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

async function loadScannerView() {
  const token = getTokenFromUrl();

  resetActionState();

  if (!token) {
    setText(
      "scanner-load-status",
      "No tag token was found in the URL. Open the page through a QR-linked token URL."
    );
    setText("error-message", "No active WaveTag link was found for this page.");
    showOnly("error-card");
    return;
  }

  try {
    const data = await fetchJson(`/api/tags/${token}`);
    const tag = data.tag;
    const registrationState = ["unclaimed", "inactive"].includes(tag.status);

    setSummaryForTag(tag);
    setValue("request-token", tag.token);
    setText("plate-mask-preview", tag.maskedPlateNumber || "••••");
    emergencyAvailable = tag.emergencyAvailable === true;

    const configuredSupport = String(data.supportWhatsapp || "").replace(/\D/g, "");
    supportWhatsappDigits = configuredSupport || FALLBACK_SUPPORT_WHATSAPP;
    setupQuickActions(tag);

    if (registrationState) {
      setText("scanner-load-status", "This WaveTag needs owner registration before contact can be enabled.");
      setText(
        "registration-title",
        tag.status === "inactive"
          ? "You are about to reactivate the tag"
          : "You are about to activate the tag"
      );
      setText(
        "registration-copy",
        tag.status === "inactive"
          ? "This tag is currently inactive. Reactivate it to start receiving alerts again."
          : "Please activate all your tags — each one is unique."
      );
      setupActivationWizard(tag, data.supportWhatsapp);
      showOnly("registration-shell");
      return;
    }

    // The contact card is the first thing a scanner meets. Nothing here is
    // owner data — the plate is masked, the label is generic, and every
    // contact action still stops at plate verification before it can reach
    // anybody. Choosing first means a scanner who only wants to send the
    // WhatsApp alert is never asked for anything they do not need to give.
    setText("scanner-load-status", "Choose how you'd like to reach the owner.");
    setVerifiedBadge(false);
    showOnly("scanner-action-shell");
    setRequestStatus("request-status", "", "info");
  } catch (error) {
    setText("scanner-load-status", "This WaveTag could not be loaded.");
    setText(
      "error-message",
      error instanceof Error ? error.message : "Failed to load the tag"
    );
    showOnly("error-card");
  }
}

async function handlePlateVerification(event) {
  event.preventDefault();

  const entered = byId("plate-last-four-input")?.value.trim();
  const token = byId("request-token")?.value.trim() || getTokenFromUrl();

  if (!entered) {
    setRequestStatus("plate-verify-status", "Enter the last 4 digits first.", "error");
    return;
  }

  setDisabled("plate-verify-submit", true);
  setRequestStatus("plate-verify-status", "Verifying…", "info");

  // Verification happens entirely server-side — the correct digits are never
  // sent to the browser. The server returns a grant we attach to contact calls.
  let response;
  try {
    response = await fetch(`/api/tags/${token}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastFour: entered })
    });
  } catch (_) {
    setDisabled("plate-verify-submit", false);
    setRequestStatus("plate-verify-status", "Network error. Please try again.", "error");
    return;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    setDisabled("plate-verify-submit", false);
    let msg = data.error || "Verification failed. Please try again.";
    if (typeof data.attemptsRemaining === "number") {
      msg += ` ${data.attemptsRemaining} attempt(s) left.`;
    }
    setRequestStatus("plate-verify-status", msg, "error");

    // A wrong plate (401) is the one failure the scanner can fix by re-reading
    // the vehicle, so it gets the dialog and says what "last 4" means. A
    // lockout (423) or a server fault has nothing to correct, so those stay on
    // the status line. The line keeps the attempts count either way — it is
    // the warning before the lockout, and the dialog copy does not carry it.
    if (response.status === 401) {
      showAlert(PLATE_MISMATCH_MESSAGE, "plate-verify-status");
    }
    return;
  }

  contactGrant = data.grant || "";
  unlimitedContact = data.unlimitedContact === true;
  verifiedPlateLastFour = entered;
  setDisabled("plate-verify-submit", false);
  setRequestStatus("plate-verify-status", "", "info");
  showOnly("scanner-action-shell");
  setVerifiedBadge(true);
  // Reflect free-usage state: show buttons, or the Purchase CTA if used up.
  // Whether this tag has anything left is only knowable after the plate
  // checks out — the load payload deliberately withholds it, so that scanning
  // a stranger's tag cannot be used to probe how it has been used.
  setContactAvailability(data.contactAvailable !== false);

  if (data.contactAvailable === false) {
    pendingVerifiedAction = "";
    setRequestStatus("request-status", "Verified ✓", "success");
    return;
  }

  const resuming = pendingVerifiedAction;
  pendingVerifiedAction = "";
  setRequestStatus("request-status", "Verified ✓", "success");
  runVerifiedAction(resuming);
}

// Every contact action passes through here. Verifying once is enough for the
// rest of the visit: the server issues a single grant and each action carries
// it, so a scanner who calls and then messages is not asked twice.
function requireVerification(action) {
  if (contactGrant) {
    runVerifiedAction(action);
    return;
  }

  pendingVerifiedAction = action;
  showOnly("scanner-verification-shell");
  setRequestStatus(
    "plate-verify-status",
    "Enter the last 4 digits shown on the vehicle plate.",
    "info"
  );
  byId("plate-last-four-input")?.focus();
}

function runVerifiedAction(action) {
  if (action === "call") {
    requestContactNumber("call");
    return;
  }

  if (action === "message") {
    handleWhatsAppNotify();
    return;
  }

  if (action === "sos") {
    openSosConfirm();
  }
}

// The badge states a fact about this session, so it cannot be on screen before
// the plate has actually been confirmed.
function setVerifiedBadge(verified) {
  setHidden("pt-verified-badge", !verified);
}

async function handleFinalCallAction() {
  if (actionLocked) return;

  const token = byId("request-token")?.value.trim();
  const phone = byId("contact-phone")?.value.trim();

  if (!token || !phone) {
    setRequestStatus("request-status", "Return to the landing page and enter your number.", "error");
    return;
  }

  actionLocked = true;
  setDisabled("final-call-button", true);
  setDisabled("send-whatsapp-button", true);
  setRequestStatus("request-status", "Preparing your call…", "info");

  let virtualNumber = "";
  try {
    const res = await fetch(`/api/tags/${token}/register-call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone, grant: contactGrant })
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 402) {
      setContactAvailability(false);
      actionLocked = false;
      setDisabled("final-call-button", false);
      setDisabled("send-whatsapp-button", false);
      return;
    }
    if (!res.ok) throw new Error(data.error || "Could not register the call.");
    virtualNumber = data.virtualNumber || "";
  } catch (error) {
    actionLocked = false;
    setDisabled("final-call-button", false);
    setDisabled("send-whatsapp-button", false);
    setRequestStatus("request-status", error instanceof Error ? error.message : "Could not start the call.", "error");
    return;
  }

  // Show the virtual number visibly as a fallback in case tel: doesn't auto-open.
  if (virtualNumber) {
    setText("dial-virtual-number", virtualNumber);
    setHidden("dial-number-block", false);
    window.location.href = `tel:${virtualNumber}`;
  }

  // Let scanner tap again manually if the dialer didn't open automatically.
  const btn = byId("final-call-button");
  if (btn && virtualNumber) {
    btn.disabled = false;
    btn.textContent = "Tap to Call";
    btn.onclick = () => { window.location.href = `tel:${virtualNumber}`; };
  }

  setRequestStatus("request-status", "Your phone dialer should open now.", "success");
}

function openWhatsAppPanel() {
  setHidden("call-popup", true);
  setHidden("message-panel", false);
  setHidden("message-editor-shell", true);
  setHidden("dial-panel", true);
  setValue("message-template-select", "");
  setValue("message-text", DEFAULT_MESSAGE);
  setRequestStatus(
    "request-status",
    "Select a message template or choose a custom message to continue.",
    "info"
  );
}

function handleTemplateSelection(event) {
  const value = event.target.value;

  if (!value) {
    setHidden("message-editor-shell", true);
    setValue("message-text", DEFAULT_MESSAGE);
    return;
  }

  if (value === "custom") {
    setValue("message-text", DEFAULT_MESSAGE);
  } else {
    setValue("message-text", MESSAGE_TEMPLATES[value] || DEFAULT_MESSAGE);
  }

  setHidden("message-editor-shell", false);
  setRequestStatus(
    "request-status",
    "Review the WhatsApp message and send it to the owner.",
    "info"
  );
}

// Raises the alert dialog. Falls back to the caller's own status line where
// <dialog> is unsupported, so the tap still says something rather than nothing.
function showAlert(message, fallbackStatusId = "request-status") {
  setText("pt-alert-copy", message);

  const dialog = byId("pt-alert");
  if (!dialog || typeof dialog.showModal !== "function") {
    setRequestStatus(fallbackStatusId, message, "error");
    return;
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

// The reason is what the owner actually reads — the server builds the WhatsApp
// message from it, so an alert sent without one says a vehicle needs attention
// and nothing else. Gate the send rather than deliver an empty one.
function hasContactReason() {
  if (selectedReason) {
    return true;
  }
  showAlert("Please select a reason why do you want to contact the owner.");
  return false;
}

// WhatsApp = notify the owner with a SERVER-BUILT message (spec §6). The scanner
// never authors the message and never needs to share their own number — the
// alert goes one-way to the owner. We only pass the reason key.
async function handleWhatsAppNotify() {
  if (actionLocked) {
    return;
  }

  if (!hasContactReason()) {
    return;
  }

  const token = byId("request-token")?.value.trim() || getTokenFromUrl();

  setRequestStatus("request-status", "Notifying the owner on WhatsApp…", "info");
  actionLocked = true;
  setDisabled("call-owner-button", true);
  setDisabled("send-whatsapp-button", true);

  try {
    await createRequest({
      token,
      action: "message",
      messageChannel: "whatsapp",
      reason: selectedReason || undefined
    });

    setHidden("request-confirmation", false);
    setText("confirmation-title", "Owner notified on WhatsApp");
    setText(
      "confirmation-copy",
      "We've sent a WhatsApp alert to the vehicle owner. Your details stay completely private."
    );
    setRequestStatus("request-status", "WhatsApp alert sent to the owner.", "success");

    // A premium tag is paid for and has no contact limit, so notifying the
    // owner must not cost the scanner their call. `actionLocked` is released
    // because it also guards the number-submit and dial handlers further down
    // the call path, not just this button.
    // Only the call button comes back: an E-Tag has genuinely spent its one
    // contact here, and for premium the WhatsApp button stays down so a single
    // scanner cannot sit on the page repeating alerts at the owner.
    if (unlimitedContact) {
      actionLocked = false;
      setDisabled("call-owner-button", false);
      setText(
        "confirmation-copy",
        "We've sent a WhatsApp alert to the vehicle owner. You can still call the owner privately — your details stay completely private."
      );
    }
  } catch (error) {
    actionLocked = false;
    setDisabled("call-owner-button", false);
    setDisabled("send-whatsapp-button", false);
    // A 402 (free contact used) already flips the UI to the Purchase CTA.
    if (!error.freeUsed) {
      setRequestStatus(
        "request-status",
        error instanceof Error ? error.message : "Could not notify the owner.",
        "error"
      );
    }
  }
}

function requestContactNumber(action) {
  pendingAction = action;
  // Clear the previous action's receipt. On a premium tag the WhatsApp
  // confirmation is still on screen when the call is started, and leaving it
  // above the number field reads as if the call had already been placed.
  setHidden("request-confirmation", true);
  setHidden("contact-number-panel", false);
  // Take the emergency block's place rather than stacking underneath it. Every
  // element between the action buttons and this panel is hidden at this point,
  // so closing the SOS block lands the number field directly under the buttons
  // — visible without scrolling, which is the whole point on a phone held at a
  // windscreen. resetActionState/setContactAvailability bring the block back
  // when the card is re-evaluated.
  setHidden("pt-sos-block", true);
  setHidden("dial-panel", true);
  setHidden("message-panel", true);
  setHidden("message-editor-shell", true);
  setHidden("call-popup", true);
  setRequestStatus(
    "request-status",
    action === "call"
      ? "Enter your phone number to continue to the dial panel."
      : "Enter your phone number to continue to the WhatsApp message panel.",
    "info"
  );
}

function handleContactNumberSubmit() {
  const phone = byId("contact-phone")?.value.trim();

  if (!verifiedPlateLastFour) {
    setRequestStatus("request-status", "Verify the vehicle plate first.", "error");
    return;
  }

  if (!phone) {
    setRequestStatus("request-status", "Enter your phone number first.", "error");
    return;
  }

  setHidden("contact-number-panel", true);

  if (pendingAction === "call") {
    setHidden("dial-number-block", true);
    setHidden("dial-panel", false);
    setRequestStatus("request-status", "Tap Call Now to connect with the owner privately.", "info");
    return;
  }

  if (pendingAction === "message") {
    openWhatsAppPanel();
  }
}

// ── Activation wizard ────────────────────────────────────────────────────

function setBtnLoading(id, loading) {
  const btn = byId(id);

  if (!btn) {
    return;
  }

  btn.disabled = loading;
  btn.classList.toggle("pt-btn-loading", loading);
}

function normalizePlate(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function showActStep(step) {
  for (const id of Object.values(ACT_STEP_IDS)) {
    setHidden(id, id !== ACT_STEP_IDS[step]);
  }

  // Progress dots: everything before the current step reads as done. The
  // success screen has no step of its own, so all four settle as done.
  const position = step === "done" ? 5 : step;
  document.querySelectorAll("#act-progress .pt-step-dot").forEach((dot) => {
    const n = Number(dot.dataset.step);
    dot.dataset.state = n === position ? "current" : n < position ? "done" : "pending";
  });
  setHidden("act-progress", step === "done");

  setRequestStatus("claim-status", "", "info");

  // Step 1 and the success screen have no input — focusing there would pop the
  // mobile keyboard for nothing.
  if (step !== 1 && step !== "done") {
    byId(ACT_STEP_IDS[step])?.querySelector("input")?.focus();
  }
}

function setupActivationWizard(tag, supportWhatsapp) {
  activation.plate = "";
  activation.name = "";
  activation.phone = "";
  setValue("act-plate", "");
  setValue("act-name", "");
  setValue("act-phone", "");
  setValue("act-otp", "");
  clearResendCooldown();

  const digits = String(supportWhatsapp || "").replace(/\D/g, "");
  supportWhatsappHref = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(
        `Hi, I need help activating my ParkTag sticker (${tag.token}).`
      )}`
    : "";
  const helpLink = byId("act-help-link");
  if (helpLink && supportWhatsappHref) {
    helpLink.href = supportWhatsappHref;
  }

  showActStep(1);
}

function handleActPlate(event) {
  event.preventDefault();

  const plate = normalizePlate(byId("act-plate")?.value);

  if (plate.length < 4 || plate.length > 16) {
    setRequestStatus(
      "claim-status",
      "Enter the full number plate exactly as printed on the vehicle.",
      "error"
    );
    return;
  }

  // Scanners unlock contact by entering the plate's last 4 digits, so a plate
  // that doesn't end in 4 digits would leave this tag permanently unverifiable.
  if (!/\d{4}$/.test(plate)) {
    setRequestStatus(
      "claim-status",
      "That doesn't look complete — a full plate ends with 4 digits (e.g. DL8CX55665).",
      "error"
    );
    return;
  }

  activation.plate = plate;
  setValue("act-plate", plate);
  showActStep(3);
}

async function sendActivationOtp() {
  const recaptchaToken = await getCaptchaToken("send_otp");

  await fetchJson("/api/auth/send-otp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier: activation.phone, recaptchaToken })
  });
}

async function handleActMobile(event) {
  event.preventDefault();

  const name = byId("act-name")?.value.trim() || "";
  const dialCode = byId("act-dial")?.value || "91";
  const digits = (byId("act-phone")?.value || "").replace(/\D/g, "");

  if (name.length < 2) {
    setRequestStatus("claim-status", "Enter your full name.", "error");
    byId("act-name")?.focus();
    return;
  }

  if (digits.length < 6 || digits.length > 14) {
    setRequestStatus("claim-status", "Enter a valid mobile number.", "error");
    byId("act-phone")?.focus();
    return;
  }

  activation.name = name;
  activation.phone = `+${dialCode}${digits}`;

  setBtnLoading("act-send-otp-btn", true);
  setRequestStatus("claim-status", "Sending your code on WhatsApp…", "info");

  try {
    await sendActivationOtp();
  } catch (error) {
    setBtnLoading("act-send-otp-btn", false);
    setRequestStatus(
      "claim-status",
      error instanceof Error ? error.message : "Could not send the code. Please try again.",
      "error"
    );
    return;
  }

  setBtnLoading("act-send-otp-btn", false);
  setText("act-phone-echo", activation.phone);
  showActStep(4);
  startResendCooldown();
}

function clearResendCooldown() {
  if (resendTimer) {
    clearInterval(resendTimer);
    resendTimer = null;
  }

  const btn = byId("act-resend-btn");
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Resend code";
  }
}

function startResendCooldown(seconds = 30) {
  const btn = byId("act-resend-btn");

  if (!btn) {
    return;
  }

  clearResendCooldown();

  let remaining = seconds;
  btn.disabled = true;
  btn.textContent = `Resend in ${remaining}s`;

  resendTimer = setInterval(() => {
    remaining -= 1;

    if (remaining <= 0) {
      clearResendCooldown();
      return;
    }

    btn.textContent = `Resend in ${remaining}s`;
  }, 1000);
}

async function handleActResend() {
  if (!activation.phone) {
    showActStep(3);
    return;
  }

  setRequestStatus("claim-status", "Sending a new code…", "info");
  startResendCooldown();

  try {
    await sendActivationOtp();
    setRequestStatus("claim-status", "New code sent on WhatsApp.", "success");
  } catch (error) {
    clearResendCooldown();
    setRequestStatus(
      "claim-status",
      error instanceof Error ? error.message : "Could not resend the code.",
      "error"
    );
  }
}

async function handleActVerify(event) {
  event.preventDefault();

  const token = getTokenFromUrl();
  const code = (byId("act-otp")?.value || "").replace(/\D/g, "");

  if (code.length !== 6) {
    setRequestStatus("claim-status", "Enter the 6-digit code.", "error");
    return;
  }

  setBtnLoading("act-verify-btn", true);
  setRequestStatus("claim-status", "Activating your tag…", "info");

  try {
    const data = await fetchJson(`/api/tags/${token}/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: activation.name,
        phone: activation.phone,
        code,
        plateNumber: activation.plate
      })
    });

    clearResendCooldown();
    setBtnLoading("act-verify-btn", false);

    setText(
      "act-done-copy",
      "Your vehicle sticker is live. Anyone who scans it can reach you privately — your number stays hidden."
    );
    showActStep("done");
  } catch (error) {
    setBtnLoading("act-verify-btn", false);
    setRequestStatus(
      "claim-status",
      error instanceof Error ? error.message : "Could not activate the tag.",
      "error"
    );
  }
}

await loadScannerView();

byId("plate-verify-form")?.addEventListener("submit", handlePlateVerification);
byId("plate-verify-cancel")?.addEventListener("click", () => {
  pendingVerifiedAction = "";
  setValue("plate-last-four-input", "");
  setRequestStatus("plate-verify-status", "", "info");
  showOnly("scanner-action-shell");
  setRequestStatus("request-status", "", "info");
});
byId("call-owner-button")?.addEventListener("click", () => requireVerification("call"));
// The reason is checked before the plate, not after: being sent to verify and
// then told to pick a reason would be two corrections for one tap.
byId("send-whatsapp-button")?.addEventListener("click", () => {
  if (!hasContactReason()) return;
  requireVerification("message");
});
byId("pt-alert-ok")?.addEventListener("click", () => byId("pt-alert")?.close());
byId("quick-share")?.addEventListener("click", handleQuickShare);
byId("contact-number-submit")?.addEventListener("click", handleContactNumberSubmit);
byId("final-call-button")?.addEventListener("click", handleFinalCallAction);

// Backs out of the number panel and puts the card back the way the tap found
// it. The mirror of requestContactNumber: that took the emergency block's
// place, so cancelling has to hand it back. Unconditional, like every other
// restore now that the button is offered on every active tag — leaving the old
// `!emergencyAvailable` here would have made cancelling a Private Call the one
// way to lose an Emergency button the card had been showing all along. The
// typed number is left alone: on a premium tag the scanner may be coming
// straight back, and retyping it is the only cost of a mis-tap.
byId("contact-number-cancel")?.addEventListener("click", () => {
  setHidden("contact-number-panel", true);
  setHidden("pt-sos-block", false);
  pendingAction = null;
  setRequestStatus("request-status", "", "info");
});

// Emergency / SOS — the button opens the confirmation gate, which is the only
// thing that opens the panel.
byId("sos-button")?.addEventListener("click", () => requireVerification("sos"));
byId("sos-confirm-check")?.addEventListener("change", (event) => {
  setDisabled("sos-confirm-continue", !event.target.checked);
});
byId("sos-confirm-close")?.addEventListener("click", () => {
  byId("sos-confirm")?.close();
});
byId("sos-confirm-continue")?.addEventListener("click", () => {
  // Re-read the box rather than trusting the button's own disabled state: the
  // two are set in different places, and this is the last point before a
  // stranger's phone rings.
  if (!byId("sos-confirm-check")?.checked) {
    return;
  }
  byId("sos-confirm")?.close();

  // Where the confirmed tap actually goes: the owner's nominated contact if
  // there is one, otherwise the public helplines. The branch is here rather
  // than on the Emergency button so the warning is read either way — the
  // offence it names applies to dialling 112 for a prank just as much.
  if (emergencyAvailable) {
    openSosPanel();
    return;
  }
  openSosHelplines();
});

byId("sos-helplines-close")?.addEventListener("click", () => {
  byId("sos-helplines")?.close();
});
byId("sos-helplines-back")?.addEventListener("click", () => {
  byId("sos-helplines")?.close();
});
byId("sos-number-submit")?.addEventListener("click", handleSosNumberSubmit);
byId("sos-final-call-button")?.addEventListener("click", handleSosCall);
byId("sos-cancel")?.addEventListener("click", () => {
  closeSosPanels();
  // openSosPanel closed the block to take its place — bring it back. It is no
  // longer conditional: every active tag offers the button, and what it leads
  // to is decided at the gate.
  setHidden("pt-sos-block", false);
  setRequestStatus("request-status", "", "info");
});

// Activation wizard
byId("act-start-btn")?.addEventListener("click", () => showActStep(2));
byId("act-step-2")?.addEventListener("submit", handleActPlate);
byId("act-step-3")?.addEventListener("submit", handleActMobile);
byId("act-step-4")?.addEventListener("submit", handleActVerify);
byId("act-resend-btn")?.addEventListener("click", handleActResend);

document.querySelectorAll(".pt-step-back").forEach((btn) => {
  btn.addEventListener("click", () => showActStep(Number(btn.dataset.goto)));
});

// Keep the plate field uppercase as it's typed so what's shown matches what's stored.
byId("act-plate")?.addEventListener("input", (event) => {
  const input = event.target;
  const caret = input.selectionStart;
  input.value = input.value.toUpperCase();
  input.setSelectionRange(caret, caret);
});

// Reason chips — select an optional reason (the message itself is server-built).
// A second tap clears the selection.
document.querySelectorAll(".pt-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const wasSelected = chip.classList.contains("pt-chip-selected");
    document.querySelectorAll(".pt-chip").forEach(c => c.classList.remove("pt-chip-selected"));
    if (wasSelected) {
      selectedReason = "";
    } else {
      chip.classList.add("pt-chip-selected");
      selectedReason = chip.dataset.reason || "";
    }
  });
});
