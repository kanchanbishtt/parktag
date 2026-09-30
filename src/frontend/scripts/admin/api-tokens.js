const listEl = document.getElementById("tokens");
const msgEl = document.getElementById("msg");
const formEl = document.getElementById("token-form");
const submitEl = document.getElementById("token-submit");
const revealEl = document.getElementById("reveal");
const revealValueEl = document.getElementById("reveal-value");
const revealCopyEl = document.getElementById("reveal-copy");
const revealDoneEl = document.getElementById("reveal-done");

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(s) {
  if (!s) return "-";
  try { return new Date(s).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return s; }
}
function show(kind, text) {
  msgEl.className = `msg ${kind}`;
  msgEl.textContent = text;
}
function clearMsg() {
  msgEl.className = "msg";
  msgEl.textContent = "";
}

// A token is only ever live in this element until the admin dismisses it. It is
// never written to storage or the URL: the server shows it once and keeps a hash.
function hideReveal() {
  revealValueEl.textContent = "";
  revealEl.hidden = true;
}

function statusOf(t) {
  if (t.revokedAt) return { key: "revoked", label: "Revoked" };
  if (new Date(t.expiresAt).getTime() <= Date.now()) return { key: "expired", label: "Expired" };
  return { key: "active", label: "Active" };
}

function render(tokens) {
  if (!tokens.length) {
    listEl.innerHTML = `<p class="empty">No tokens yet. Create one above for a script or tool that needs the admin API.</p>`;
    return;
  }
  listEl.innerHTML = `<div class="card"><table>
    <thead><tr><th>Name</th><th>Scope</th><th>Token</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th></th></tr></thead>
    <tbody>${tokens.map((t) => {
      const st = statusOf(t);
      return `<tr>
        <td class="name">${esc(t.name)}</td>
        <td><span class="pill ${esc(t.scope)}">${esc(t.scope)}</span></td>
        <td class="mono">${esc(t.tokenPrefix)}…</td>
        <td>${esc(fmtDate(t.createdAt))}</td>
        <td>${esc(fmtDate(t.expiresAt))}</td>
        <td class="muted">${t.lastUsedAt ? esc(fmtDate(t.lastUsedAt)) : "Never"}</td>
        <td><span class="pill ${st.key}">${st.label}</span></td>
        <td>${st.key === "active" ? `<button class="revoke" data-id="${esc(t.id)}" data-name="${esc(t.name)}">Revoke</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody></table></div>`;
}

async function load() {
  try {
    const res = await fetch("/api/admin/api-tokens", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
    render(data.data || []);
  } catch {
    listEl.innerHTML = `<p class="empty err-text">Could not load your tokens.</p>`;
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMsg();
  hideReveal();

  const name = formEl.elements.name.value.trim();
  const days = Number(formEl.elements.days.value);
  if (!name) { show("err", "Give the token a name."); formEl.elements.name.focus(); return; }
  if (!Number.isInteger(days) || days < 1 || days > 90) { show("err", "Days must be a whole number from 1 to 90."); formEl.elements.days.focus(); return; }

  submitEl.disabled = true;
  submitEl.textContent = "Creating…";
  try {
    const res = await fetch("/api/admin/api-tokens", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, scope: formEl.elements.scope.value, days })
    });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not create the token.");

    revealValueEl.textContent = data.data.token;
    revealEl.hidden = false;
    revealEl.scrollIntoView({ block: "nearest" });
    formEl.reset();
    formEl.elements.days.value = "30";
    await load();
  } catch (err) {
    show("err", err.message || "Could not create the token.");
  } finally {
    submitEl.disabled = false;
    submitEl.textContent = "Create token";
  }
});

revealCopyEl.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(revealValueEl.textContent);
    revealCopyEl.textContent = "Copied";
  } catch {
    // No clipboard permission: select the text so Ctrl/Cmd+C works.
    const range = document.createRange();
    range.selectNodeContents(revealValueEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    revealCopyEl.textContent = "Press Ctrl+C";
  }
  setTimeout(() => { revealCopyEl.textContent = "Copy"; }, 2500);
});

revealDoneEl.addEventListener("click", hideReveal);

listEl.addEventListener("click", async (event) => {
  const btn = event.target.closest("button.revoke");
  if (!btn) return;
  const name = btn.dataset.name;
  if (!window.confirm(`Revoke "${name}"? Anything using it stops working immediately.`)) return;

  clearMsg();
  btn.disabled = true;
  btn.textContent = "Revoking…";
  try {
    const res = await fetch(`/api/admin/api-tokens/${encodeURIComponent(btn.dataset.id)}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (res.status === 401 || res.status === 403) { window.location.href = "/admin"; return; }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not revoke the token.");
    show("ok", `Revoked "${name}".`);
  } catch (err) {
    show("err", err.message || "Could not revoke the token.");
  } finally {
    await load();
  }
});

load();
