function goToActivation() {
  const input = document.getElementById("token-input");
  const errorEl = document.getElementById("token-error");
  const raw = (input?.value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (errorEl) errorEl.textContent = "";

  if (raw.length !== 12) {
    if (errorEl) errorEl.textContent = "Sticker code must be exactly 12 characters.";
    input?.focus();
    return;
  }

  window.location.href = `/vehicle/${raw}`;
}

document.getElementById("go-to-activation-btn")?.addEventListener("click", goToActivation);

document.getElementById("token-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") goToActivation();
});
