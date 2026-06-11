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
let currentCallPreviewNumber = "";

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
  const match = path.match(/\/vehicle\/([A-Za-z0-9]{12})/);

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
  currentCallPreviewNumber = "";
  pendingAction = null;
  setDisabled("call-owner-button", false);
  setDisabled("send-whatsapp-button", false);
  setDisabled("submit-message-button", false);
  setDisabled("contact-number-submit", false);
  setDisabled("final-call-button", false);
}

function setSummaryForTag(tag) {
  const isRegistrationState = ["unclaimed", "inactive"].includes(tag.status);

  setText("tag-chip", isRegistrationState ? "Registration required" : "✓ Active");

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
  return fetchJson("/api/contact-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
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
    setValue("claim-vehicle-label", tag.vehicleLabel || "");
    setValue("claim-plate-number", "");
    expectedPlateLastFour = tag.plateLastFour || "";
    setText("plate-mask-preview", tag.maskedPlateNumber || "Loading...");

    if (registrationState) {
      setText("scanner-load-status", "This WaveTag needs owner registration before contact can be enabled.");
      setText(
        "registration-title",
        tag.status === "inactive"
          ? "Activate this WaveTag for owner contact"
          : "Register this WaveTag"
      );
      setText(
        "registration-copy",
        tag.status === "inactive"
          ? "This tag is currently inactive. Fill in the owner registration details below to activate it on WaveTag."
          : "This sticker has not been activated yet. Complete the owner registration details below to activate it on WaveTag."
      );
      showOnly("registration-shell");
      return;
    }

    setText(
      "scanner-load-status",
      "Confirm the vehicle plate first to continue."
    );
    currentCallPreviewNumber = tag.callPreviewNumber || "";
    setText("dial-virtual-number", "");
    setHidden("dial-number-block", true);
    showOnly("scanner-verification-shell");
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

  if (!entered) {
    setRequestStatus("plate-verify-status", "Enter the last 4 digits first.", "error");
    return;
  }

  if (!expectedPlateLastFour) {
    setRequestStatus("plate-verify-status", "Vehicle digits are not ready yet. Reload the page.", "error");
    return;
  }

  if (entered !== expectedPlateLastFour) {
    setRequestStatus("plate-verify-status", "Those last 4 digits do not match this vehicle.", "error");
    return;
  }

  verifiedPlateLastFour = entered;
  showOnly("scanner-action-shell");
  setRequestStatus(
    "request-status",
    "Choose Call Owner or Leave WhatsApp message.",
    "info"
  );
}

async function handleFinalCallAction() {
  if (actionLocked) {
    return;
  }

  const token = byId("request-token")?.value.trim();
  const phone = byId("contact-phone")?.value.trim();

  if (!token || !phone) {
    setRequestStatus("request-status", "Return to the landing shell and enter your number.", "error");
    return;
  }

  actionLocked = true;
  setDisabled("final-call-button", true);
  setDisabled("send-whatsapp-button", true);
  setRequestStatus("request-status", "Creating your call request...", "info");

  try {
    await createRequest({
      token,
      phone,
      action: "call"
    });

    setHidden("call-popup", false);
    setHidden("request-confirmation", false);
    setText("confirmation-title", "Call request sent");
    setText(
      "confirmation-copy",
      "WaveTag has recorded your request. You will be receiving a call sooner."
    );
    setRequestStatus("request-status", "Call request created successfully.", "success");
  } catch (error) {
    actionLocked = false;
    setDisabled("final-call-button", false);
    setDisabled("send-whatsapp-button", false);
    setRequestStatus(
      "request-status",
      error instanceof Error ? error.message : "Failed to create the call request",
      "error"
    );
  }
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

async function handleWhatsAppAction() {
  if (actionLocked) {
    return;
  }

  const token = byId("request-token")?.value.trim();
  const phone = byId("contact-phone")?.value.trim();
  const message = byId("message-text")?.value.trim();
  const template = byId("message-template-select")?.value;

  if (!template) {
    setRequestStatus("request-status", "Choose a message template first.", "error");
    return;
  }

  if (!message) {
    setRequestStatus("request-status", "Enter a message for the owner.", "error");
    return;
  }

  setRequestStatus("request-status", "Sending your WhatsApp request...", "info");
  actionLocked = true;
  setDisabled("call-owner-button", true);
  setDisabled("send-whatsapp-button", true);
  setDisabled("submit-message-button", true);

  try {
    await createRequest({
      token,
      phone,
      action: "message",
      messageChannel: "whatsapp",
      message
    });

    setHidden("request-confirmation", false);
    setText("confirmation-title", "WhatsApp request sent");
    setText(
      "confirmation-copy",
      "Your WhatsApp message request has been recorded for the owner through WaveTag."
    );
    setRequestStatus("request-status", "WhatsApp request created successfully.", "success");
  } catch (error) {
    actionLocked = false;
    setDisabled("call-owner-button", false);
    setDisabled("send-whatsapp-button", false);
    setDisabled("submit-message-button", false);
    setRequestStatus(
      "request-status",
      error instanceof Error
        ? error.message
        : "Failed to create the WhatsApp request",
      "error"
    );
  }
}

function requestContactNumber(action) {
  pendingAction = action;
  setHidden("contact-number-panel", false);
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
    setText("dial-virtual-number", currentCallPreviewNumber || "");
    setHidden("dial-number-block", !currentCallPreviewNumber);
    setHidden("dial-panel", false);
    setRequestStatus(
      "request-status",
      "Review the dial panel and press Call Now to start the call request.",
      "info"
    );
    return;
  }

  if (pendingAction === "message") {
    openWhatsAppPanel();
  }
}

async function handleClaim(event) {
  event.preventDefault();

  const token = getTokenFromUrl();
  const displayName = byId("claim-display-name")?.value.trim();
  const email = byId("claim-email")?.value.trim();
  const phone = byId("claim-phone")?.value.trim();
  const password = byId("claim-password")?.value.trim();
  const vehicleLabel = byId("claim-vehicle-label")?.value.trim();
  const plateNumber = byId("claim-plate-number")?.value.trim();

  if (!displayName || !email || !phone || !password || !plateNumber) {
    setRequestStatus(
      "claim-status",
      "Enter your name, email, phone number, password, and vehicle number.",
      "error"
    );
    return;
  }

  setRequestStatus("claim-status", "Activating your WaveTag...", "info");

  try {
    await fetchJson(`/api/tags/${token}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        displayName,
        email,
        phone,
        password,
        vehicleLabel,
        plateNumber
      })
    });

    setRequestStatus(
      "claim-status",
      "Tag activated successfully. You can now sign in from /owner.",
      "success"
    );
    await loadScannerView();
  } catch (error) {
    setRequestStatus(
      "claim-status",
      error instanceof Error ? error.message : "Failed to claim the tag",
      "error"
    );
  }
}

await loadScannerView();

byId("plate-verify-form")?.addEventListener("submit", handlePlateVerification);
byId("call-owner-button")?.addEventListener("click", () => requestContactNumber("call"));
byId("send-whatsapp-button")?.addEventListener("click", () => requestContactNumber("message"));
byId("contact-number-submit")?.addEventListener("click", handleContactNumberSubmit);
byId("final-call-button")?.addEventListener("click", handleFinalCallAction);
byId("message-template-select")?.addEventListener("change", handleTemplateSelection);
byId("submit-message-button")?.addEventListener("click", handleWhatsAppAction);
byId("claim-form")?.addEventListener("submit", handleClaim);

// Reason chips — pre-select a message template and open the contact flow
document.querySelectorAll(".pt-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const msg = chip.dataset.msg;
    if (!msg) return;
    // highlight selected chip
    document.querySelectorAll(".pt-chip").forEach(c => c.classList.remove("pt-chip-selected"));
    chip.classList.add("pt-chip-selected");
    // pre-fill custom message and open WhatsApp panel
    setValue("message-text", msg);
    setValue("message-template-select", "custom");
    requestContactNumber("message");
  });
});
