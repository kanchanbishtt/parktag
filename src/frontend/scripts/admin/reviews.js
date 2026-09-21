const list = document.getElementById("reviews");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDate(s) {
  if (!s) return "";
  try { return new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
}

function render(reviews) {
  if (!reviews.length) {
    list.innerHTML = `<p class="empty">No replies yet.</p>`;
    return;
  }
  list.innerHTML = reviews.map((r) => `
    <div class="review${r.approved ? " is-approved" : ""}">
      <div>
        <div class="meta"><b>${esc(r.name || "-")}</b> · ${esc(r.orderNumber || "-")} · ${esc(r.phone)} · ${esc(fmtDate(r.receivedAt))}${r.approved ? `<span class="pill">Approved</span>` : ""}</div>
        ${r.texts.length ? r.texts.map((t) => `<p>${esc(t)}</p>`).join("") : `<p class="meta">(photo only)</p>`}
        <button class="toggle" data-id="${esc(r.id)}" data-approved="${r.approved ? "1" : ""}">${r.approved ? "Unapprove" : "Approve"}</button>
      </div>
      ${r.hasPhoto ? `<a href="/api/admin/reviews/${esc(r.id)}/photo" target="_blank" rel="noopener"><img src="/api/admin/reviews/${esc(r.id)}/photo" alt="Photo from ${esc(r.name || "buyer")}" loading="lazy" /></a>` : ""}
    </div>`).join("");
}

async function load() {
  try {
    const res = await fetch("/api/admin/reviews", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed");
    render(data.reviews || []);
  } catch {
    list.innerHTML = `<p class="err">Could not load reviews.</p>`;
  }
}

list.addEventListener("click", async (event) => {
  const button = event.target.closest("button.toggle");
  if (!button) return;
  button.disabled = true;
  try {
    const res = await fetch(`/api/admin/reviews/${encodeURIComponent(button.dataset.id)}/approve`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: !button.dataset.approved })
    });
    if (!res.ok) throw new Error("Failed");
    await load();
  } catch {
    button.disabled = false;
    alert("Could not update that review.");
  }
});

load();
