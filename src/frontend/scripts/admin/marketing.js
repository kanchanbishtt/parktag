// Field-demo shelf.
//
// The stickers are just listed. Activation happens where it always happens —
// the customer scans the QR and runs the real wizard — and this shelf notices
// on its own. Each row then offers the two answers to "did they buy it?":
//
//   ACTIVATED (status)  ·  Deactivate Tag  ·  Sold
//
// Written for someone standing in front of a customer on patchy mobile data:
// every action either clearly succeeds or clearly fails, buttons lock while in
// flight so a double-tap cannot fire twice, and every outcome re-reads from the
// server rather than trusting what the button guessed.

const listEl = document.getElementById("list");
const countsEl = document.getElementById("counts");
const msgEl = document.getElementById("msg");
const searchEl = document.getElementById("q");

let query = "";

function show(kind, text) {
  msgEl.className = "msg " + kind;
  msgEl.textContent = text;
}

function clearMsg() {
  msgEl.className = "msg";
  msgEl.textContent = "";
}

function fmtWhen(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function renderCounts(s) {
  countsEl.innerHTML = "";
  for (const [value, label] of [
    [s.units, "Units"],
    [s.stickers, "Stickers"],
    [s.available, "Available"],
    [s.activated, "Activated"],
    [s.sold, "Sold"]
  ]) {
    const el = document.createElement("div");
    el.className = "count";
    // textContent throughout: serials, names and plates are server data and
    // must never be parsed as markup.
    const b = document.createElement("b");
    b.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    el.append(b, span);
    countsEl.append(el);
  }
}

const STATE_LABEL = { available: "Available", activated: "ACTIVATED", sold: "SOLD" };

function renderRow(item) {
  const card = document.createElement("div");
  card.className = "card";

  const main = document.createElement("div");
  main.className = "card-main";

  const serial = document.createElement("div");
  serial.className = "serial";
  serial.textContent = item.serial;
  if (item.copiesPrinted > 1) {
    const copies = document.createElement("span");
    copies.className = "copies";
    copies.textContent = item.copiesPrinted + " copies";
    serial.append(copies);
  }
  main.append(serial);

  const meta = document.createElement("div");
  meta.className = "meta";
  const bits = [item.demoCount === 1 ? "1 activation" : item.demoCount + " activations"];
  if (item.state === "sold" && item.soldAt) {
    bits.push("sold " + fmtWhen(item.soldAt));
    if (item.soldBy) bits.push("by " + item.soldBy);
  } else if (item.activatedAt) {
    bits.push("since " + fmtWhen(item.activatedAt));
  }
  meta.textContent = bits.join(" · ");
  main.append(meta);

  // Who is on the sticker, so he can confirm he is looking at the person in
  // front of him before taking payment.
  if (item.activatedBy) {
    const who = document.createElement("div");
    who.className = "prospect";
    who.textContent = item.activatedBy + (item.plateNumber ? " · " + item.plateNumber : "");
    main.append(who);
  }

  const state = document.createElement("span");
  state.className = "state " + item.state;
  state.textContent = STATE_LABEL[item.state] || item.state;

  const actions = document.createElement("div");
  actions.className = "actions";
  const off = Boolean(item.blockedReason);

  if (item.state === "activated") {
    const deact = document.createElement("button");
    deact.className = "toggle stop";
    deact.textContent = "Deactivate Tag";
    deact.dataset.deactivate = item.id;
    deact.disabled = off;

    const sold = document.createElement("button");
    sold.className = "toggle go";
    sold.textContent = "Sold";
    sold.dataset.sold = item.id;
    sold.disabled = off;

    actions.append(deact, sold);
  } else if (item.state === "available") {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "Scan the sticker to activate";
    actions.append(hint);
  }

  card.append(main, state, actions);

  if (item.blockedReason) {
    const blocked = document.createElement("div");
    blocked.className = "blocked";
    blocked.textContent = item.blockedReason;
    card.append(blocked);
  }

  return card;
}

async function load() {
  try {
    const url = "/api/admin/marketing" + (query ? "?q=" + encodeURIComponent(query) : "");
    const res = await fetch(url, { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/admin";
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load demo stock.");

    renderCounts(data.summary);
    listEl.innerHTML = "";

    if (!data.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = query
        ? `No demo sticker matches "${query}".`
        : "No demo stock yet. Use Add new tag to put a printed sticker on the shelf.";
      listEl.append(empty);
      return;
    }

    for (const item of data.items) listEl.append(renderRow(item));
  } catch (err) {
    show("err", err.message || "Could not load demo stock.");
  }
}

// One place that talks to the server, so every action gets the same in-flight
// lock, the same error surface, and the same re-read afterwards.
async function act(btn, action, id, busyText, okText) {
  clearMsg();
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = busyText;

  try {
    const res = await fetch(`/api/admin/marketing/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/admin";
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not change this sticker.");
    show("ok", okText);
  } catch (err) {
    show("err", err.message || "Could not change this sticker.");
    btn.textContent = original;
  } finally {
    await load();
  }
}

listEl.addEventListener("click", async (event) => {
  const deact = event.target.closest("button[data-deactivate]");
  if (deact && !deact.disabled) {
    if (!window.confirm("Deactivate this tag?\n\nEverything the customer entered during activation will be erased, and the sticker goes back in the bag as new.")) {
      return;
    }
    await act(
      deact,
      "deactivate",
      deact.dataset.deactivate,
      "Wiping…",
      "Deactivated — details erased. This sticker is new again."
    );
    return;
  }

  const sold = event.target.closest("button[data-sold]");
  if (sold && !sold.disabled) {
    // Terminal from this screen: after this the unit belongs to the customer.
    if (!window.confirm("Mark this unit sold?\n\nThe tag stays on the customer's account permanently.")) {
      return;
    }
    await act(sold, "sold", sold.dataset.sold, "Saving…", "Marked sold.");
  }
});

// ── Add a printed sticker ────────────────────────────────────────────────────
//
// Serials cannot always be looked up in advance — the sticker is in a hand or a
// folder, not a spreadsheet — so the shelf has to accept one from anywhere. The
// server does the resolving and all the refusing; this only collects the serial
// and a copy count and reports back exactly what it was told.

const MIN_COPIES = 1;
const MAX_COPIES = 500;

const fabEl = document.getElementById("add-fab");
const sheetEl = document.getElementById("add-sheet");
const formEl = document.getElementById("add-form");
const serialEl = document.getElementById("add-serial");
const copiesEl = document.getElementById("add-copies");
const minusEl = document.getElementById("qty-minus");
const plusEl = document.getElementById("qty-plus");
const cancelEl = document.getElementById("add-cancel");
const submitEl = document.getElementById("add-submit");
const sheetMsgEl = document.getElementById("add-msg");

function currentCopies() {
  const n = Number.parseInt(copiesEl.value, 10);
  return Number.isInteger(n) ? n : MIN_COPIES;
}

// One place that writes the count, so the buttons, typing and the clamp can
// never disagree about what the field holds.
function setCopies(next) {
  const clamped = Math.min(MAX_COPIES, Math.max(MIN_COPIES, next));
  copiesEl.value = String(clamped);
  minusEl.disabled = clamped <= MIN_COPIES;
  plusEl.disabled = clamped >= MAX_COPIES;
}

function setSheetError(text) {
  sheetMsgEl.className = text ? "sheet-msg err" : "sheet-msg";
  sheetMsgEl.textContent = text || "";
}

function openSheet() {
  setSheetError("");
  serialEl.value = "";
  setCopies(1);
  submitEl.disabled = false;
  submitEl.textContent = "Add to Field Demo";
  sheetEl.showModal();
  serialEl.focus();
}

if (fabEl && sheetEl) {
  fabEl.addEventListener("click", openSheet);
  cancelEl.addEventListener("click", () => sheetEl.close());

  minusEl.addEventListener("click", () => setCopies(currentCopies() - 1));
  plusEl.addEventListener("click", () => setCopies(currentCopies() + 1));
  // Typed input is clamped on the way out, not on every keystroke — clamping
  // mid-type turns "24" into "2" the moment the first digit lands.
  copiesEl.addEventListener("change", () => setCopies(currentCopies()));

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    setSheetError("");

    const serial = serialEl.value.trim();
    if (!serial) {
      setSheetError("Enter the serial printed on the sticker.");
      serialEl.focus();
      return;
    }

    submitEl.disabled = true;
    submitEl.textContent = "Adding…";

    try {
      const res = await fetch("/api/admin/marketing/add", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serial, copies: currentCopies() })
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin";
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not add this sticker.");

      // Kept inside the dialog until it succeeds: a refusal ("already belongs to
      // a customer", "matches more than one sticker") is something to correct
      // here, not a message to read after the form has vanished.
      sheetEl.close();
      show("ok", data.message || "Added to Field Demo.");
      // Clear any search first, or the sticker just added can be filtered out of
      // the list it was added to.
      if (searchEl && query) {
        searchEl.value = "";
        query = "";
      }
      await load();
    } catch (err) {
      setSheetError(err.message || "Could not add this sticker.");
      submitEl.disabled = false;
      submitEl.textContent = "Add to Field Demo";
    }
  });
}

if (searchEl) {
  let timer = null;
  searchEl.addEventListener("input", () => {
    // Debounced so typing a serial does not fire a request per keystroke.
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = searchEl.value.trim();
      load();
    }, 250);
  });
}

load();
