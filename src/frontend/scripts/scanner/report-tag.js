// Public tag-report form. Reached from the "Report wrong info" action on the
// scan page, carrying the tag token in ?tag=.
//
// Nothing here reads owner data — the page only ever knows the token that was
// already in the scanner's URL, and the report goes to support, not the owner.

const SUPPORT_WHATSAPP_FALLBACK = "918791638854";

// Reason keys must match REPORT_REASONS on the server.
const REASON_LABELS = {
  sold: "Vehicle is Sold",
  wrong_number: "Wrong Number",
  no_answer: "No one Answered",
  abuse: "Abuse",
  other: "Others"
};

let selectedReason = "";
let captchaWidgetId = null;
let captchaRequired = false;

function byId(id) {
  return document.getElementById(id);
}

function getToken() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("tag") || "";
  // Same shape the scan routes accept. Anything else is not a token and must
  // not be echoed into the page.
  return /^[A-Za-z0-9]{12,64}$/.test(raw) ? raw : "";
}

function setStatus(message, tone) {
  const el = byId("report-status");

  if (!el) {
    return;
  }

  el.textContent = message;
  el.dataset.tone = tone;
  el.hidden = !message;
}

function setReason(reason) {
  selectedReason = reason;

  for (const button of document.querySelectorAll(".pt-report-reason")) {
    const active = button.dataset.reason === reason;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
    // Roving tabindex: the group is one stop, arrows move within it.
    button.tabIndex = active ? 0 : -1;
  }

  // "Others" says nothing on its own, so it opens a free-text box. The five
  // named reasons are self-describing and do not need one.
  setHiddenField(reason === "other");
}

function setHiddenField(show) {
  const field = byId("report-details-field");

  if (field) {
    field.hidden = !show;
  }
}

function moveReasonFocus(step) {
  const buttons = [...document.querySelectorAll(".pt-report-reason")];
  const current = buttons.findIndex((b) => b.dataset.reason === selectedReason);
  const next = buttons[(current + step + buttons.length) % buttons.length] || buttons[0];

  setReason(next.dataset.reason);
  next.focus();
}

async function setUpCaptcha() {
  const holder = byId("report-captcha");

  if (!holder) {
    return;
  }

  let siteKey = "";

  try {
    const res = await fetch("/api/recaptcha/v2-config");
    const data = await res.json();
    siteKey = (data && data.siteKey) || "";
  } catch {
    siteKey = "";
  }

  // No key configured → no widget, and the server skips verification to match.
  // Leaving an empty grey box on the page would look like a broken control.
  if (!siteKey) {
    return;
  }

  captchaRequired = true;
  holder.hidden = false;

  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.google.com/recaptcha/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("recaptcha-load-failed"));
    document.head.appendChild(script);
  }).catch(() => null);

  if (!window.grecaptcha) {
    // Google is unreachable. The server fails open on the same condition, so
    // the form stays usable rather than becoming a dead end.
    captchaRequired = false;
    holder.hidden = true;
    return;
  }

  window.grecaptcha.ready(() => {
    captchaWidgetId = window.grecaptcha.render(holder, { sitekey: siteKey });
  });
}

function captchaResponse() {
  if (!captchaRequired || captchaWidgetId === null || !window.grecaptcha) {
    return "";
  }

  return window.grecaptcha.getResponse(captchaWidgetId) || "";
}

async function submitReport(event) {
  event.preventDefault();

  const token = getToken();

  if (!token) {
    setStatus("This page needs to be opened from a tag. Scan the tag again.", "error");
    return;
  }

  if (!selectedReason) {
    setStatus("Choose the closest reason for your report.", "error");
    return;
  }

  const name = byId("report-name")?.value.trim() || "";
  const phone = byId("report-phone")?.value.trim() || "";
  const details = byId("report-details")?.value.trim() || "";

  if (!name) {
    setStatus("Enter your name.", "error");
    byId("report-name")?.focus();
    return;
  }

  if (!/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) {
    setStatus("Enter a valid 10-digit phone number.", "error");
    byId("report-phone")?.focus();
    return;
  }

  const captchaToken = captchaResponse();

  if (captchaRequired && !captchaToken) {
    setStatus("Please confirm you are not a robot.", "error");
    return;
  }

  const submit = byId("report-submit");

  if (submit) {
    submit.disabled = true;
  }

  setStatus("Sending your report…", "info");

  try {
    const res = await fetch(`/api/tags/${token}/report`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: selectedReason,
        details,
        name,
        phone,
        captchaToken
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "We could not send your report. Please try again.");
    }

    byId("report-form")?.reset();
    setReason("");
    setStatus(
      "Thanks — your report is with our team. We will call you if we need more.",
      "success"
    );
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "We could not send your report.",
      "error"
    );
  } finally {
    if (submit) {
      submit.disabled = false;
    }

    // A v2 token is single-use: Google rejects the same response twice, so a
    // retry after a failure needs a fresh tick of the box.
    if (captchaRequired && window.grecaptcha && captchaWidgetId !== null) {
      window.grecaptcha.reset(captchaWidgetId);
    }
  }
}

// The tag's own identifier — the serial printed on a premium sticker, or the
// PT-XXXXXXXX E-Tag id. Derived server-side by the same helpers the owner
// dashboard and admin use, so the number a reporter reads out is the number
// support finds. Left as "—" if the tag cannot be loaded, rather than showing
// something invented from the URL.
async function loadTagId(token) {
  if (!token) {
    return;
  }

  try {
    const res = await fetch(`/api/tags/${token}`);
    const data = await res.json();

    if (data && data.ok && data.tag && data.tag.tagId) {
      setStatusText("report-tag-id", data.tag.tagId);
    }
  } catch {
    // Leave the placeholder. The report itself carries the token, so support
    // can identify the tag whether or not this line rendered.
  }
}

function init() {
  const token = getToken();

  loadTagId(token);

  const transferHref = `https://wa.me/${SUPPORT_WHATSAPP_FALLBACK}?text=${encodeURIComponent(
    `Hi ParkTag, I bought a vehicle that has a ParkTag on it and want the tag transferred to my name.\nTag: ${token || "(not scanned)"}`
  )}`;

  const transfer = byId("report-transfer-wa");

  if (transfer) {
    transfer.href = transferHref;
  }

  const back = byId("report-back");

  // Points at the tag this report is about, so leaving the form and returning
  // does not lose which tag it was. The history fallback below covers the
  // normal case where they arrived from the scan page anyway.
  if (token && back) {
    back.href = `/tag/${token}`;
  }

  back?.addEventListener("click", (event) => {
    if (history.length > 1) {
      event.preventDefault();
      history.back();
    }
  });

  for (const button of document.querySelectorAll(".pt-report-reason")) {
    button.tabIndex = -1;
    button.addEventListener("click", () => setReason(button.dataset.reason));
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        moveReasonFocus(1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        moveReasonFocus(-1);
      }
    });
  }

  // The first reason is the group's tab stop until one is chosen.
  const first = document.querySelector(".pt-report-reason");
  if (first) first.tabIndex = 0;

  byId("report-phone")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 10);
  });

  byId("report-form")?.addEventListener("submit", submitReport);

  setUpCaptcha();
}

function setStatusText(id, text) {
  const el = byId(id);

  if (el) {
    el.textContent = text;
  }
}

init();
