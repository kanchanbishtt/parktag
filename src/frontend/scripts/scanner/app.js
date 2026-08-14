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
// A number typed on the verification card, for the Private Call path only.
// Held here so the call is registered and dialled straight off the card
// instead of asking for the same number again on the next screen.
let verifyCapturedPhone = "";
// The verification card showing its number field without the plate step,
// because the plate was already confirmed earlier this visit. The submit then
// has nothing to verify and goes straight to placing the call.
let verifyPhoneOnly = false;
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

const activation = { plate: "", name: "", phone: "", type: "" };

// Artwork icons, not line drawings. Car and bike reuse the shop's own tag
// artwork, so one vehicle looks the same in the shop, the picker and the
// dashboard.
//
// These are <img> rather than inline SVG because the four road-vehicle files
// arrived as PNG bitmaps inside an SVG wrapper — that is what Figma writes when
// a placed bitmap is exported as SVG, and they carry zero vector paths. Each
// was trimmed to its artwork, squared, downscaled to 120px and recoloured from
// black to #03162D to match the car and bike, which cut the six chips from the
// ~492 KB the originals weighed to ~48 KB. Being raster, they will not stay
// crisp much past 34px — replace them with real vectors before drawing bigger.
//
// The trade-off of dropping inline SVG is that a selected chip no longer tints
// its icon the way `currentColor` did. The amber border, fill and label still
// carry the selection — the same way the shop's nav rows have always shown it.
//
// Copied rather than imported: scripts/owner/welcome.js and
// scripts/owner/register.js each already carry their own copy of this map, and
// the scanner bundle is cache-busted through scannerAssetVersion while a bare
// import would not be. Worth consolidating into one shared module when those
// two files are next touched.
const VEHICLE_ICON_SRC = {
  car: "/images/car-tag.svg",
  bike: "/images/bike-tag.svg",
  scooter: "/images/vtype-scooter.png",
  auto_rickshaw: "/images/vtype-auto.png",
  truck: "/images/vtype-truck.png",
  bus: "/images/vtype-bus.png"
};

// 34px, not the 22px the line icons used: the auto and the truck are detailed
// silhouettes that blur into a smudge below about 34. Width and height are set
// in the markup as well as the stylesheet so the grid cannot reflow between
// first paint and the image decoding.
const VEHICLE_ICONS = Object.fromEntries(
  Object.entries(VEHICLE_ICON_SRC).map(([type, src]) => [
    type,
    `<img src="${src}" alt="" width="34" height="34" decoding="async" aria-hidden="true">`
  ])
);

// The picker offered on activation step 2. Mirrors VEHICLE_LABELS in
// lib/core/tag-issuance.js — the server validates against that same map, so an
// option added here without adding it there is rejected rather than silently
// stored. Order is deliberate: the two most common types lead each category.
// Rendered in this order for every sticker — Car and Bike lead because nearly
// every tag goes on one of them. `category` is no longer used for ordering; it
// stays because it documents which mount type each option belongs to.
const VEHICLE_TYPE_OPTIONS = [
  { type: "car", label: "Car", category: "four_wheeler" },
  { type: "bike", label: "Bike", category: "two_wheeler" },
  { type: "truck", label: "Truck", category: "four_wheeler" },
  { type: "bus", label: "Bus", category: "four_wheeler" },
  { type: "auto_rickshaw", label: "Auto", category: "four_wheeler" },
  { type: "scooter", label: "Scooter", category: "two_wheeler" }
];
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

// ── Verification overlay ─────────────────────────────────────────────────
// The card is raised over the contact card rather than replacing it. The page
// behind keeps its scroll position, so dismissing the card returns the scanner
// to exactly the spot they tapped from.
//
// `body.pt-modal-open` locks the page behind from scrolling: without it, a
// swipe over the blur scrolls the contact card underneath, which reads as the
// overlay having come loose.
function openVerifyModal() {
  // Locking the body removes the scrollbar, which widens the viewport: the page
  // behind jumps sideways under the blur, and the card lands a few pixels wider
  // than the card it replaced. Publish the gutter as a custom property and hand
  // it back as padding on BOTH the page and the overlay — the overlay is
  // position:fixed, so the body's own padding never reaches it. Measured, not
  // assumed: 0 with the overlay scrollbars phones use, ~15px on a desktop.
  const gutter = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.setProperty("--pt-scroll-gutter", `${Math.max(gutter, 0)}px`);
  setHidden("verify-modal", false);
  document.body.classList.add("pt-modal-open");
}

function closeVerifyModal() {
  setHidden("verify-modal", true);
  document.body.classList.remove("pt-modal-open");
  document.documentElement.style.removeProperty("--pt-scroll-gutter");
}

function isVerifyModalOpen() {
  const el = byId("verify-modal");
  return Boolean(el) && !el.hidden;
}

function setRequestStatus(targetId, message, tone = "info") {
  const el = byId(targetId);

  if (!el) {
    return;
  }

  el.textContent = message;
  el.dataset.tone = tone;
}

// The verification card is no longer one of these: it is an overlay raised over
// whichever section is showing (see openVerifyModal), so it is not part of the
// swap. Any section change does dismiss it, though — arriving at a new screen
// with a stale modal still floating over it would be a bug.
function showOnly(sectionId) {
  const ids = [
    "registration-shell",
    "scanner-action-shell",
    "error-card"
  ];

  for (const id of ids) {
    setHidden(id, id !== sectionId);
  }

  closeVerifyModal();

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
  setValue("message-template-select", "");
  setValue("message-text", DEFAULT_MESSAGE);
  setValue("contact-phone", "");
  verifyCapturedPhone = "";
  verifyPhoneOnly = false;
  setHidden("plate-verify-plate-block", false);
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
// The same shape as the owner call — number captured on the verification card,
// then dial the masked virtual number — but pointed at
// /register-emergency-call so the Dial Whom webhook resolves the owner's
// emergency contact instead of the owner.
function closeSosPanels() {
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
      requireVerification("sos");
    } else {
      openSosHelplines();
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

// Closes the ordinary contact panels so only one flow is ever live. Called
// before the emergency dial panel opens.
function closeContactPanels() {
  setHidden("dial-panel", true);
  setHidden("message-panel", true);
  setHidden("call-popup", true);
  setHidden("request-confirmation", true);
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

  // Check the number before the plate goes anywhere. A failed verification
  // counts against the lockout, so a mistyped phone must not cost the scanner
  // one of their attempts at a plate they had right.
  //
  // Both calls are captured here. This must stay in step with `wantsNumber` in
  // requireVerification(): if a card asks for a number but this does not read
  // it, verifyCapturedPhone stays empty and runVerifiedAction sends the scanner
  // straight back to the card — a loop with no way out.
  if (pendingVerifiedAction === "call" || pendingVerifiedAction === "sos") {
    const typed = byId("plate-verify-phone")?.value.trim() || "";
    if (typed.replace(/\D/g, "").length < 7) {
      setRequestStatus(
        "plate-verify-status",
        pendingVerifiedAction === "sos"
          ? "Enter a valid phone number so the emergency contact's call can reach you."
          : "Enter a valid phone number so the owner's call can reach you.",
        "error"
      );
      byId("plate-verify-phone")?.focus();
      return;
    }
    verifyCapturedPhone = typed;
  }

  // The plate was confirmed earlier this visit, so the card is showing the
  // number field on its own and there is nothing left to check. Take the
  // number and go straight to placing the call.
  if (verifyPhoneOnly) {
    verifyPhoneOnly = false;
    const resumingWithGrant = pendingVerifiedAction;
    pendingVerifiedAction = "";
    setRequestStatus("plate-verify-status", "", "info");
    showOnly("scanner-action-shell");
    runVerifiedAction(resumingWithGrant);
    return;
  }

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
  // Both calls need a number to ring back — the owner call and the emergency
  // call are the same masked mechanism pointed at different people. Emergency
  // used to collect its number on a panel of its own (#sos-number-panel), which
  // is why it looked and behaved unlike the other two; it now asks on this card,
  // so all three actions open the identical card.
  const wantsNumber = action === "call" || action === "sos";

  // WhatsApp needs nothing from the scanner, so a grant is the whole of what it
  // was waiting for. Either call still needs a number, and that number is only
  // ever asked for on this card — so a verified scanner tapping Private Call or
  // Emergency comes back here rather than to a second panel.
  if (contactGrant && !wantsNumber) {
    runVerifiedAction(action);
    return;
  }

  verifyPhoneOnly = Boolean(contactGrant) && wantsNumber;
  pendingVerifiedAction = action;
  setHidden("plate-verify-call-block", !wantsNumber);
  setHidden("plate-verify-plate-block", verifyPhoneOnly);
  setValue("plate-verify-phone", "");
  verifyCapturedPhone = "";
  const submit = byId("plate-verify-submit");
  if (submit) {
    submit.textContent = wantsNumber ? "Setup Masked Call" : "Verify & Continue";
  }
  // Identical block, identical styling — it just has to name the right person.
  const callNote = byId("plate-verify-callnote");
  if (callNote) {
    callNote.innerHTML =
      action === "sos"
        ? "We will need your phone number to setup a <strong>MASKED</strong> call between you and the owner's emergency contact."
        : "We will need your phone number to setup a <strong>MASKED</strong> call between you and tag owner.";
  }
  openVerifyModal();
  setRequestStatus(
    "plate-verify-status",
    verifyPhoneOnly
      ? "Enter your number and we'll connect the masked call."
      : "Enter the last 4 digits shown on the vehicle plate.",
    "info"
  );
  (verifyPhoneOnly ? byId("plate-verify-phone") : byId("plate-last-four-input"))?.focus();
}

function runVerifiedAction(action) {
  if (action === "call") {
    // The number was given on the verification card, so nothing is left to ask
    // and nothing is left to tap: register the call and hand the handset the
    // virtual number in the same gesture that submitted the card. The dial
    // panel still opens — it is the receipt, and the fallback tap for a browser
    // that declines to open the dialer on its own.
    if (verifyCapturedPhone) {
      setValue("contact-phone", verifyCapturedPhone);
      verifyCapturedPhone = "";
      setHidden("dial-number-block", true);
      setHidden("dial-panel", false);
      handleFinalCallAction();
      return;
    }
    // No number in hand — the card is where it gets asked for, never a second
    // panel. Reachable only if a grant outlived the number that came with it.
    requireVerification("call");
    return;
  }

  if (action === "message") {
    handleWhatsAppNotify();
    return;
  }

  if (action === "sos") {
    // Mirrors the owner-call branch above, deliberately: the number came from
    // the same field on the same card, so there is nothing left to ask and
    // nothing left to tap. The dial panel still opens as the receipt and as the
    // fallback tap for a browser that will not open the dialer itself.
    //
    // The consent gate is NOT here — it runs before the card (see the
    // #sos-button handler), so the warning is read before we ask a scanner
    // standing at a crash to type anything.
    if (verifyCapturedPhone) {
      setValue("sos-phone", verifyCapturedPhone);
      verifyCapturedPhone = "";
      closeContactPanels();
      // The emergency block steps aside so the dial panel takes its place,
      // exactly as the block did for the old number panel.
      setHidden("pt-sos-block", true);
      setHidden("sos-dial-number-block", true);
      setHidden("sos-dial-panel", false);
      handleSosCall();
      return;
    }
    // No number in hand — the card is where it gets asked for, never a second
    // panel. Reachable only if a grant outlived the number that came with it.
    requireVerification("sos");
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

  // Carry the chosen vehicle type into the later steps' wording. Done here
  // rather than at the moment of choosing, so it is right however the step was
  // reached — including via "Previous Step" back from the OTP screen.
  syncVehicleNoun();

  // Step 1 and the success screen have no input — focusing there would pop the
  // mobile keyboard for nothing.
  if (step !== 1 && step !== "done") {
    byId(ACT_STEP_IDS[step])?.querySelector("input")?.focus();
  }
}

// Draws the vehicle-type picker and applies the server's suggestion.
//
// The suggestion comes from the sticker's mount type: a windscreen sticker is
// glued for the inside of glass, so it is a four-wheeler; an exterior one goes
// on a tank or headlamp, so it is a two-wheeler. That narrows the CATEGORY, not
// the exact type, so it is used to pre-select the commonest member and to float
// that category to the front — the owner still confirms, and a wrong guess is
// one tap to fix.
//
// A tag issued before mount types existed sends no suggestion, and then nothing
// is pre-selected. That is the deliberate choice: an unanswered question reads
// as a question, whereas a confident wrong answer reads as a broken app.
function renderVehicleTypePicker(tag) {
  const grid = byId("act-vtype-grid");
  if (!grid) return;

  const suggested = tag && tag.suggestedVehicleType;

  // One fixed order for every sticker: Car then Bike, the two vehicles almost
  // every tag goes on, with the rarer ones after. The grid used to float the
  // sticker's own category to the front, which pushed Bike to the fifth slot
  // on a car sticker — worse for the common case than a stable order the eye
  // learns. The sticker still drives which option opens pre-selected below;
  // only the ordering stopped reacting to it.
  const options = VEHICLE_TYPE_OPTIONS;

  grid.innerHTML = options
    .map(
      (o) =>
        `<button type="button" class="pt-vtype-btn" role="radio" data-vtype="${o.type}"` +
        ` aria-checked="${o.type === suggested ? "true" : "false"}">` +
        `<span class="pt-vtype-ico" aria-hidden="true">${VEHICLE_ICONS[o.type] || ""}</span>` +
        `<span>${o.label}</span></button>`
    )
    .join("");

  activation.type = suggested || "";

  // Say WHY something is already chosen. A pre-selection nobody explains is a
  // pre-selection nobody checks.
  const hint = byId("act-vtype-hint");
  if (hint) {
    hint.textContent = suggested
      ? "Pre-filled from your sticker type — tap to change it."
      : "";
    hint.hidden = !suggested;
  }
}

// Replaces the generic "Vehicle" in the later steps with what was actually
// chosen. Falls back to the generic word when nothing is set yet, so the
// heading is never left blank or half-written.
function syncVehicleNoun() {
  const chosen = VEHICLE_TYPE_OPTIONS.find((o) => o.type === activation.type);
  setText("act-vehicle-noun", chosen ? chosen.label : "Vehicle");
}

function selectVehicleType(type) {
  activation.type = type;
  syncVehicleNoun();
  const grid = byId("act-vtype-grid");
  if (!grid) return;
  grid.querySelectorAll(".pt-vtype-btn").forEach((btn) => {
    btn.setAttribute("aria-checked", btn.dataset.vtype === type ? "true" : "false");
  });
}

function setupActivationWizard(tag, supportWhatsapp) {
  activation.plate = "";
  activation.name = "";
  activation.phone = "";
  activation.type = "";
  setValue("act-plate", "");
  setValue("act-name", "");
  setValue("act-phone", "");
  setValue("act-otp", "");
  renderVehicleTypePicker(tag);
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

  // Checked after the plate so the two errors cannot both fire at once, and so
  // a scanner who typed a good plate is not sent back over it.
  if (!activation.type) {
    setRequestStatus(
      "claim-status",
      "Choose the type of vehicle this tag is going on.",
      "error"
    );
    byId("act-vtype-grid")?.scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  activation.plate = plate;
  setValue("act-plate", plate);
  setRequestStatus("claim-status", "", "info");
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
        plateNumber: activation.plate,
        // Captured on step 2. The server requires it and validates it against
        // its own type list, so this is the value the dashboard will show.
        vehicleType: activation.type
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

// Every way out of the card runs this, so a dismissal can never leave half the
// state behind — whether it came from Cancel, Escape, or a tap on the blur.
function dismissVerifyModal() {
  pendingVerifiedAction = "";
  setValue("plate-last-four-input", "");
  // Do not leave a typed number sitting in a hidden field after a cancel.
  setValue("plate-verify-phone", "");
  verifyCapturedPhone = "";
  // Put the plate step back, or the next scanner to open this card without a
  // grant would be asked for a number and never for the plate.
  verifyPhoneOnly = false;
  setHidden("plate-verify-plate-block", false);
  setHidden("plate-verify-call-block", true);
  setRequestStatus("plate-verify-status", "", "info");
  showOnly("scanner-action-shell");
  setRequestStatus("request-status", "", "info");
}

byId("plate-verify-cancel")?.addEventListener("click", dismissVerifyModal);

// Escape closes it, the way the <dialog>-based gates on this page already do —
// the card should not be the one overlay that traps you.
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isVerifyModalOpen()) {
    dismissVerifyModal();
  }
});

// A tap on the blur closes it too — including the gutter either side of the
// card, which reads as backdrop to anyone looking at it. Anything that lands on
// the card itself is ignored, so a drag that starts in the input and releases
// outside cannot dismiss the card mid-typing.
byId("verify-modal")?.addEventListener("click", (event) => {
  const card = byId("scanner-verification-shell");
  if (card && !card.contains(event.target)) {
    dismissVerifyModal();
  }
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
// Re-dial only. The first dial is fired by the verification card's submit; this
// button exists for the browser that would not open the dialer by itself.
byId("final-call-button")?.addEventListener("click", handleFinalCallAction);

// Emergency / SOS — the button opens the confirmation gate, and the gate is the
// only thing that opens the verification card. The gate runs BEFORE the card,
// not after: the warning it carries is the reason to stop, so making someone
// read a plate and type a number first would put it after the effort rather
// than before the decision.
byId("sos-button")?.addEventListener("click", openSosConfirm);
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
  //
  // With a contact to reach, this now opens the SAME verification card the
  // other two actions use, asking for the plate and the scanner's number
  // together, instead of the emergency-only panel it used to open.
  if (emergencyAvailable) {
    requireVerification("sos");
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
byId("sos-final-call-button")?.addEventListener("click", handleSosCall);

// Activation wizard
byId("act-start-btn")?.addEventListener("click", () => showActStep(2));
byId("act-step-2")?.addEventListener("submit", handleActPlate);

// Delegated, because the buttons are rendered after this file runs (the picker
// is drawn from the tag payload once the tag loads).
byId("act-vtype-grid")?.addEventListener("click", (event) => {
  const btn = event.target.closest(".pt-vtype-btn");
  if (!btn) return;
  selectVehicleType(btn.dataset.vtype);
  setRequestStatus("claim-status", "", "info");
});
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
