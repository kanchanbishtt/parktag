// /backup/<token>: a backup contact taking their number off an owner.
// The token is the last path segment. Nothing is sent until the button is
// pressed (routes/public/backup-contact.js).

function byId(id) {
  return document.getElementById(id);
}

function getToken() {
  const raw = window.location.pathname.split("/").filter(Boolean).pop() || "";
  return /^[a-f0-9]{32}$/.test(raw) ? raw : "";
}

function showDone(title, sub) {
  byId("bc-ask").hidden = true;
  byId("bc-done-title").textContent = title;
  byId("bc-done-sub").textContent = sub;
  byId("bc-done").hidden = false;
}

function setStatus(message) {
  const el = byId("bc-status");
  el.textContent = message;
  el.dataset.tone = "error";
  el.hidden = !message;
}

const token = getToken();
const button = byId("bc-remove");

if (!token) {
  showDone("This link does not work", "Please open it again from the WhatsApp message.");
}

button?.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "Removing…";
  setStatus("");
  try {
    const res = await fetch("/api/backup-contact/decline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      showDone("Your number is removed", "You will not get calls for this ParkTag. Nothing else is needed.");
      return;
    }
    if (res.status === 404) {
      showDone("This link has expired", "It has already been used, or a newer ParkTag message replaced it. If you got a newer one, use the button in that message.");
      return;
    }
    setStatus(data.error || "Something went wrong. Please try again.");
  } catch {
    setStatus("No connection. Please try again.");
  }
  button.disabled = false;
  button.textContent = "Remove my number";
});
