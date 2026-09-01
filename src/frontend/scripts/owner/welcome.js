import { callbackState, CALLABLE, NEEDS_PREMIUM, NEEDS_SUBSCRIPTION } from "./callback-eligibility.js";

// ── Banners carousel ─────────────────────────────────────────────
const track    = document.getElementById("carTrack");
const viewport = document.getElementById("carVp");
const dots     = document.querySelectorAll(".pt-dot-btn");
const TOTAL    = 3;
let cur = 0, autoTimer;

function goTo(idx) {
  cur = ((idx % TOTAL) + TOTAL) % TOTAL;
  track.style.transform = `translateX(-${cur * 100}%)`;
  dots.forEach((d, i) => d.setAttribute("aria-selected", String(i === cur)));
}

// The prev/next arrows are gone from the markup: they sat on top of the banner
// artwork and covered the words at both edges, and the slides exist to be read.
// The dots, a swipe, and the auto-advance below are the ways through them.
//
// These listeners were attached WITHOUT a null check, at the top level of this
// module — so removing the buttons alone would have thrown here and killed
// every line of dashboard setup that follows.
dots.forEach(d => d.addEventListener("click", () => goTo(Number(d.dataset.idx))));

function startAuto() { autoTimer = setInterval(() => goTo(cur + 1), 3000); }
function stopAuto()  { clearInterval(autoTimer); }
viewport.addEventListener("mouseenter", stopAuto);
viewport.addEventListener("mouseleave", startAuto);

let swipeX = 0;
track.addEventListener("touchstart", e => { swipeX = e.touches[0].clientX; }, { passive: true });
track.addEventListener("touchend",   e => {
  const dx = swipeX - e.changedTouches[0].clientX;
  if (Math.abs(dx) > 40) goTo(dx > 0 ? cur + 1 : cur - 1);
});
startAuto();

// ── Determine new/returning user ─────────────────────────────────
const urlParams = new URLSearchParams(location.search);
const newParam  = urlParams.get("new");
const isNewUser = newParam !== null
  ? newParam === "1"
  : sessionStorage.getItem("pt_is_new_user") === "1";
sessionStorage.removeItem("pt_is_new_user");

// Sign-up is reported on ARRIVAL here rather than at the moment verify-otp
// returns, because that call is immediately followed by a redirect — an event
// fired on the login page would be racing its own navigation and would mostly
// be lost. `?new=1` is set by that redirect precisely for this kind of
// first-visit handling, and only ever on the first hop.
if (isNewUser && window.ptTrack) ptTrack("sign_up", { method: "otp" });

// ── Name on the greeting ─────────────────────────────────────────
// Sign-in only ever collects an email or a mobile, so most owners arrive with
// no name at all. Rather than taxing the sign-in flow for a greeting, the
// greeting asks for itself: "Hi there!" carries a quiet "Add your name", and an
// owner who already has one gets a pencil. Ignoring it costs nothing.
let _ownerName = "";        // the name stored on the profile, "" if none

function renderGreetingAffordance(owner) {
  if (!nameEdit) return;
  _ownerName = owner.displayName || "";
  const has = Boolean(owner.hasOwnName);
  nameEdit.dataset.mode = has ? "edit" : "add";
  nameEdit.innerHTML = has ? PENCIL_SVG : `${PENCIL_SVG}<span>Add your name</span>`;
  nameEdit.setAttribute("aria-label", has ? "Edit your name" : "Add your name");
  nameEdit.title = has ? "Edit your name" : "Add your name";
  nameEdit.hidden = false;
}

function openNameEditor() {
  if (!nameForm) return;
  nameInput.value = _ownerName;
  // Only the greeting line gives way to the field — the email/mobile beneath it
  // stays put. Hiding that too made the whole header lurch and left the owner
  // with no sign of which account they were editing.
  if (greetRow) greetRow.hidden = true;
  nameForm.hidden = false;
  setNameStatus("");
  nameInput.focus();
  nameInput.select();
}

function closeNameEditor() {
  if (!nameForm) return;
  nameForm.hidden = true;
  if (greetRow) greetRow.hidden = false;
  setNameStatus("");
}

function setNameStatus(message) {
  if (!nameStatus) return;
  nameStatus.textContent = message || "";
  nameStatus.hidden = !message;
}

async function saveOwnerName(event) {
  event?.preventDefault();
  const value = (nameInput?.value || "").trim();

  const save = document.getElementById("greet-name-save");
  if (save) save.disabled = true;
  try {
    const res = await fetch("/api/owner/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: value })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      // Only a 400 carries a message written for a person ("at least 2
      // characters"). Anything else is the framework talking — a bare "Not
      // Found" from a route that isn't deployed yet means nothing to whoever
      // is typing their name, so it does not get shown to them.
      setNameStatus(
        res.status === 400 && data.error ? data.error : "Could not save your name. Please try again."
      );
      return;
    }
    _ownerName = data.displayName || "";
    if (greetName) {
      greetName.textContent = `${UI.greetPrefix} ${data.greetingName || UI.greetFallback}!`;
    }
    renderGreetingAffordance({ displayName: _ownerName, hasOwnName: data.hasOwnName });
    // Keep the menu's owner panel in step — it reads the same name. Updated
    // directly rather than through that panel's own `set` helper, which is a
    // local inside its render function and not in scope here.
    if (_owner) {
      _owner.displayName = _ownerName;
      _owner.hasOwnName = data.hasOwnName;
      const miName = document.getElementById("mi-name");
      if (miName) miName.textContent = _ownerName || _owner.email || _owner.mobile || "—";
    }
    closeNameEditor();
  } catch {
    setNameStatus("Network error. Please try again.");
  } finally {
    if (save) save.disabled = false;
  }
}

// ── DOM refs ─────────────────────────────────────────────────────
const greetName = document.getElementById("greetName");
const greetId   = document.getElementById("greetId");
const nameEdit    = document.getElementById("greet-name-edit");
const nameForm    = document.getElementById("greet-name-form");
const nameInput   = document.getElementById("greet-name-input");
const nameCancel  = document.getElementById("greet-name-cancel");
const nameStatus  = document.getElementById("greet-name-status");
const greetRow    = document.getElementById("greet-display");

const PENCIL_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Bound here rather than beside the handlers above: these run at module load,
// and the elements they attach to are declared in this block.
// The pencil opens the full details sheet now, not the one-field editor. The
// editor stays: it is what the "Add your name" prompt still uses on a first
// visit, where asking for a gender and a birthday before somebody has even told
// us their name would be the wrong first question.
nameEdit?.addEventListener("click", () => {
  if (nameEdit.dataset.mode === "add") { openNameEditor(); return; }
  openProfile();
});
nameForm?.addEventListener("submit", saveOwnerName);
nameCancel?.addEventListener("click", closeNameEditor);
// Escape backs out, the same as Cancel — the field is dismissible by design.
nameInput?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeNameEditor(); }
});

// ── Profile view ─────────────────────────────────────────────────
// The third view behind the Profile tab. Structure only for now: every row with
// somewhere real to go is wired, and the rest carry a Soon chip and do nothing,
// so the shape of the finished page is visible without anything pretending to
// work.
//
// Identity is filled from the dashboard payload rather than written into the
// markup, so it cannot drift from the greeting at the top of the page — both
// read the same _owner.

// The initial in the avatar. A name wins; failing that the identifier the owner
// signed in with, so a brand-new account still gets a letter rather than a blank
// square. Falls back to the brand's own P, never to "?" — an avatar that looks
// like a question is a bug report waiting to happen.
function _prInitial(owner) {
  const source = (owner.displayName || owner.email || owner.mobile || "").trim();
  const letter = source.replace(/[^A-Za-z]/g, "").charAt(0);
  return (letter || "P").toUpperCase();
}

// The shimmer blocks the card ships with, so the loading state can be restored
// and not only left in place. Sized to the text they stand in for, which is what
// keeps the card from changing height when the real values arrive.
const PR_SK = {
  name:  '<span class="pt-pr-sk" style="display:inline-block;width:134px;height:.92em;border-radius:6px;vertical-align:middle"></span>',
  phone: '<span class="pt-pr-sk" style="display:inline-block;width:106px;height:.78em;border-radius:5px;vertical-align:middle"></span>'
};

function renderProfileView() {
  const card = document.getElementById("prIdentity");
  const avatar = document.getElementById("prAvatar");
  const name = document.getElementById("prName");
  const phone = document.getElementById("prPhone");
  if (!name || !phone) return;

  // Nothing has arrived yet. Reachable on a cold open at #profile, where
  // switchTab draws this view before the dashboard request has resolved.
  if (!_owner) {
    if (card) { card.classList.add("loading"); card.setAttribute("aria-busy", "true"); }
    if (avatar) avatar.textContent = "";
    name.innerHTML = PR_SK.name;
    phone.innerHTML = PR_SK.phone;
    return;
  }

  const o = _owner;
  // Only the FIRST render after the payload lands fades. Every later one — a
  // saved name, a verified number — updates in place, because re-running the
  // reveal would flash the whole card each time somebody edited a field.
  const wasLoading = Boolean(card && card.classList.contains("loading"));
  if (card) {
    card.classList.remove("loading");
    card.removeAttribute("aria-busy");
    if (wasLoading) {
      card.classList.remove("ready");
      void card.offsetWidth;
      card.classList.add("ready");
    }
  }
  if (avatar) avatar.textContent = _prInitial(o);

  // textContent, not innerHTML — this is owner-supplied and goes in as text.
  // It also clears the skeleton span in the same assignment.
  //
  // "ParkTag User" only when there is genuinely nothing to show. An account with
  // a name or an email is not anonymous and should not be labelled as one.
  name.textContent = o.displayName || o.email || "ParkTag User";

  // Always the phone, because a phone glyph sits beside it — putting an email
  // there would label an address as a number. Without one it reads as the prompt
  // it is, and the pencil beside it is where that gets fixed.
  phone.textContent = o.mobile || "Add your number";
}
window.renderProfileView = renderProfileView;

// The three panels under the segmented control. Only the tab strip and the
// hidden attribute move — the panels themselves stay in the DOM so their
// contents are addressable before they are ever shown.
function switchProfilePanel(key) {
  const panels = ["account", "prefs", "support"];
  if (!panels.includes(key)) return;

  for (const p of panels) {
    const tab = document.getElementById("prTab-" + p);
    const panel = document.getElementById("prPanel-" + p);
    const on = p === key;
    if (tab) tab.setAttribute("aria-selected", on ? "true" : "false");
    if (panel) panel.hidden = !on;
  }
}
window.switchProfilePanel = switchProfilePanel;

// The Settings tile. Preferences is one of the three panels further down the
// page, so selecting it is not enough on its own — the tile sits above the
// segmented control, and switching a panel the owner cannot see reads as a tap
// that did nothing. Scrolls the strip into view so the change is watched
// happening.
function goToPreferences() {
  switchProfilePanel("prefs");
  const seg = document.querySelector("#view-profile .pt-pr-seg");
  if (seg) seg.scrollIntoView({ behavior: "smooth", block: "start" });
}
window.goToPreferences = goToPreferences;

// Opens the drawer with one of its accordion sections already expanded.
//
// Some things — orders, the vehicle list — still live in the drawer, and the
// profile view links to them. Dropping somebody at the top of a collapsed
// drawer and leaving them to find the row themselves is what makes a link feel
// broken even when it worked.
function openMenuSection(key) {
  openMenu();
  const section = document.querySelector('#menuDrawer .pt-mi[data-key="' + key + '"]');
  if (!section) return;

  // After the drawer's own transition, so the expansion is something the owner
  // watches happen rather than something already done when it slides in.
  setTimeout(() => {
    document.querySelectorAll("#menuDrawer .pt-mi.open").forEach((el) => el.classList.remove("open"));
    section.classList.add("open");
    if (key === "orders" && typeof loadOrdersOnce === "function") loadOrdersOnce();
    section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 260);
}
window.openMenuSection = openMenuSection;

// ── Profile details sheet ────────────────────────────────────────
// Everything an owner may tell us about themselves, in one place, reached from
// the pencil beside the greeting.
//
// Email and phone appear here but are READ-ONLY, and that is deliberate rather
// than an omission: both are login identifiers, so changing either moves the
// account and needs verification. The phone already has that flow, with an OTP,
// under Menu > User Info — the hint points there rather than dead-ending.
const pf = {
  sheet:  () => document.getElementById("pfSheet"),
  bk:     () => document.getElementById("pfBackdrop"),
  form:   () => document.getElementById("pfForm"),
  name:   () => document.getElementById("pfName"),
  email:  () => document.getElementById("pfEmail"),
  phone:  () => document.getElementById("pfPhone"),
  gender: () => document.getElementById("pfGender"),
  dob:    () => document.getElementById("pfDob"),
  age:    () => document.getElementById("pfAge"),
  save:   () => document.getElementById("pfSave"),
  status: () => document.getElementById("pfStatus")
};

const DOB_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Whole years from a YYYY-MM-DD string. Deliberately the same arithmetic as the
// server's ageFromDateOfBirth — the box updates as a birthday is typed, and a
// round trip for that would leave it a keystroke behind.
function _ageFrom(dob) {
  if (!DOB_PATTERN.test(String(dob || ""))) return null;
  const parts = String(dob).split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - parts[0];
  const monthsIn = now.getMonth() + 1 - parts[1];
  if (monthsIn < 0 || (monthsIn === 0 && now.getDate() < parts[2])) age -= 1;
  return age;
}

function _pfSetError(inputId, errId, message) {
  const input = document.getElementById(inputId);
  const err = document.getElementById(errId);
  if (input) input.classList.toggle("bad", Boolean(message));
  if (err) { err.textContent = message || ""; err.classList.toggle("on", Boolean(message)); }
}

function _pfSyncAge() {
  const age = _ageFrom(pf.dob()?.value);
  const box = pf.age();
  if (box) box.value = age === null ? "" : String(age);
}

function _pfStatus(message, tone) {
  const el = pf.status();
  if (!el) return;
  el.textContent = message || "";
  el.style.color = tone === "err" ? "#DC2626" : "#16A34A";
}

function openProfile() {
  const sheet = pf.sheet();
  if (!sheet) return;

  const o = _owner || {};
  const details = o.profile || {};

  if (pf.name()) pf.name().value = o.displayName || "";
  if (pf.gender()) pf.gender().value = details.gender || "";
  if (pf.dob()) pf.dob().value = details.dateOfBirth || "";

  // An identifier that is not set reads as "Not set" rather than as a blank box
  // somebody forgot to fill, and the email field is dropped entirely when there
  // is nothing to show.
  const emailField = document.getElementById("pfEmailField");
  if (pf.email()) pf.email().value = o.email || "";
  if (emailField) emailField.hidden = !o.email;

  _pfRenderPhone();

  // A birthday cannot be in the future, and the browser's own picker can say so
  // before anything is typed.
  if (pf.dob()) pf.dob().max = new Date().toISOString().slice(0, 10);

  _pfSyncAge();
  _pfSetError("pfName", "pfNameErr", "");
  _pfSetError("pfDob", "pfDobErr", "");
  _pfStatus("");

  sheet.hidden = false;
  // Next frame, so the browser lays the sheet out at translateY(100%) before the
  // class that animates it to 0 lands. Set in the same tick there is nothing to
  // transition from and the sheet simply appears.
  requestAnimationFrame(() => {
    pf.bk()?.classList.add("open");
    sheet.classList.add("open");
  });
  document.body.style.overflow = "hidden";
  setTimeout(() => pf.name()?.focus(), 340);
}
window.openProfile = openProfile;

function closeProfile() {
  const sheet = pf.sheet();
  if (!sheet) return;
  sheet.classList.remove("open");
  pf.bk()?.classList.remove("open");
  document.body.style.overflow = "";
  // Hidden only once it has slid away, so the exit animation gets to run.
  setTimeout(() => { if (!sheet.classList.contains("open")) sheet.hidden = true; }, 340);
}
window.closeProfile = closeProfile;

async function saveProfile(event) {
  event?.preventDefault();

  const name = (pf.name()?.value || "").trim();
  const dob = (pf.dob()?.value || "").trim();

  _pfSetError("pfName", "pfNameErr", "");
  _pfSetError("pfDob", "pfDobErr", "");
  _pfSetError("pfPhoneInput", "pfPhoneErr", "");

  // The one required field, checked before anything else so an owner is not
  // told about a stray character in their name while the thing actually
  // blocking the save is further down the form.
  if (!((_owner && _owner.mobile) || _ownerMobile)) {
    _pfSetError("pfPhoneInput", "pfPhoneErr",
      "A verified phone number is required — it is how scanners reach you.");
    _pfStatus("Add and verify your phone to save.", "err");
    pfPhone.input()?.focus();
    return;
  }

  // Checked here so the obvious mistakes answer instantly. The server checks the
  // same things again — this is a convenience, not the gate.
  if (name && name.length < 2) {
    _pfSetError("pfName", "pfNameErr", "Please enter at least 2 characters.");
    pf.name()?.focus();
    return;
  }
  if (dob) {
    const age = _ageFrom(dob);
    if (age === null) {
      _pfSetError("pfDob", "pfDobErr", "Enter a date of birth as YYYY-MM-DD.");
      return;
    }
    if (age < 0) { _pfSetError("pfDob", "pfDobErr", "Date of birth cannot be in the future."); return; }
    if (age < 13) { _pfSetError("pfDob", "pfDobErr", "You must be at least 13."); return; }
    if (age > 120) { _pfSetError("pfDob", "pfDobErr", "Please check the year."); return; }
  }

  const btn = pf.save();
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  _pfStatus("");

  try {
    const res = await fetch("/api/owner/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // gender and dateOfBirth are always sent from this sheet, including as
      // empty strings — that is how an owner clears one they set before. The
      // inline name editor sends displayName alone, and the server tells the two
      // apart by whether the key is present at all.
      body: JSON.stringify({
        displayName: name,
        gender: pf.gender()?.value || "",
        dateOfBirth: dob
      })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      const message = res.status === 400 && data.error
        ? data.error
        : "Could not save. Please try again.";
      // A 400 about the date belongs on the date field, not in the footer where
      // it sits furthest from the thing that needs fixing.
      if (res.status === 400 && /date|year|birth/i.test(data.error || "")) {
        _pfSetError("pfDob", "pfDobErr", data.error);
      } else if (res.status === 400 && /name|character/i.test(data.error || "")) {
        _pfSetError("pfName", "pfNameErr", data.error);
      } else {
        _pfStatus(message, "err");
      }
      return;
    }

    // The greeting, the menu panel and the cached owner all read this name.
    _ownerName = data.displayName || "";
    if (greetName) {
      greetName.textContent = UI.greetPrefix + " " + (data.greetingName || UI.greetFallback) + "!";
    }
    renderGreetingAffordance({ displayName: _ownerName, hasOwnName: data.hasOwnName });
    if (_owner) {
      _owner.displayName = _ownerName;
      _owner.hasOwnName = data.hasOwnName;
      _owner.profile = data.profile || _owner.profile;
      const miName = document.getElementById("mi-name");
      if (miName) miName.textContent = _ownerName || _owner.email || _owner.mobile || "—";
    }
    // The sheet closes onto the profile view, and the card behind it shows the
    // name that was just changed.
    renderProfileView();

    _pfStatus("Saved");
    setTimeout(closeProfile, 550);
  } catch {
    _pfStatus("Network error. Please try again.", "err");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

// ── Phone, the one required field ────────────────────────────────
//
// It is required because it is the whole product: a scanner standing at the car
// reaches the owner on this number, masked. A profile without one leaves that
// unable to happen, which is why this is the only asterisk on the sheet.
//
// Two states, never both:
//
//   already on the account   shown and locked. An owner who signed in with
//                            their phone is here already — the number was
//                            verified at sign-in and stored, so there is
//                            nothing to fetch and nothing to type.
//   not on the account       add and verify in place. Somebody who signed in
//                            with Google or an email has no number, and sending
//                            them to another screen to come back from is how a
//                            required field turns into an abandoned form.
//
// Requiredness is enforced HERE and not on PATCH /api/owner/profile. That route
// is also what the one-field name editor posts to on a first visit, before an
// owner has been asked for anything else; refusing it without a phone would
// make a brand-new account unable to save its own name. The number itself is
// still proven server-side — /api/owner/mobile will not store one without a
// matching OTP — which is the part that actually has to be trustworthy.
let _pfPendingMobile = null;

const pfPhone = {
  saved:   () => document.getElementById("pfPhoneSaved"),
  add:     () => document.getElementById("pfPhoneAdd"),
  input:   () => document.getElementById("pfPhoneInput"),
  send:    () => document.getElementById("pfPhoneSend"),
  otpRow:  () => document.getElementById("pfPhoneOtpRow"),
  otp:     () => document.getElementById("pfPhoneOtp"),
  verify:  () => document.getElementById("pfPhoneVerify")
};

// Ten digits become +91; anything longer is assumed to already carry its own
// country code. Same rule the User Info panel uses, so the two cannot normalise
// the same typing differently.
function _pfMobileFromInput() {
  const raw = (pfPhone.input()?.value || "").trim().replace(/\D/g, "");
  if (!raw || raw.length < 10) return null;
  return raw.length === 10 ? "+91" + raw : "+" + raw;
}

// Draws whichever of the two states applies. Called on open and again after a
// successful verification, so the field locks itself the moment it is satisfied.
function _pfRenderPhone() {
  const mobile = (_owner && _owner.mobile) || _ownerMobile || "";
  const has = Boolean(mobile);

  if (pfPhone.saved()) pfPhone.saved().hidden = !has;
  if (pfPhone.add()) pfPhone.add().hidden = has;

  if (has) {
    const box = document.getElementById("pfPhone");
    if (box) box.value = mobile;
    const hint = document.getElementById("pfPhoneHint");
    if (hint) hint.textContent = "Verified. Scanners reach you here without ever seeing it.";
  } else {
    _pfSetError("pfPhoneInput", "pfPhoneErr", "");
    if (pfPhone.otpRow()) pfPhone.otpRow().hidden = true;
    if (pfPhone.otp()) pfPhone.otp().value = "";
    _pfPendingMobile = null;
  }
}

async function pfSendPhoneCode() {
  const mobile = _pfMobileFromInput();
  if (!mobile) {
    _pfSetError("pfPhoneInput", "pfPhoneErr", "Enter a valid 10-digit number.");
    pfPhone.input()?.focus();
    return;
  }
  _pfSetError("pfPhoneInput", "pfPhoneErr", "");

  const btn = pfPhone.send();
  if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
  try {
    const res = await fetch("/api/owner/mobile/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      _pfSetError("pfPhoneInput", "pfPhoneErr", data.error || "Could not send the code.");
      return;
    }
    _pfPendingMobile = mobile;
    if (pfPhone.otpRow()) pfPhone.otpRow().hidden = false;
    const hint = document.getElementById("pfPhoneAddHint");
    if (hint) hint.textContent = "Code sent to " + mobile + ".";
    pfPhone.otp()?.focus();
  } catch {
    _pfSetError("pfPhoneInput", "pfPhoneErr", "Network error. Try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send code"; }
  }
}

async function pfVerifyPhoneCode() {
  const otp = (pfPhone.otp()?.value || "").trim();
  // Falls back to re-reading the field, so an owner who corrects a typo in the
  // number after the code arrives verifies the number they can actually see.
  const mobile = _pfPendingMobile || _pfMobileFromInput();

  if (!mobile) { _pfSetError("pfPhoneInput", "pfPhoneErr", "Enter a valid 10-digit number."); return; }
  if (!/^\d{6}$/.test(otp)) { _pfSetError("pfPhoneInput", "pfPhoneErr", "Enter the 6-digit code."); return; }

  const btn = pfPhone.verify();
  if (btn) { btn.disabled = true; btn.textContent = "Checking..."; }
  try {
    const res = await fetch("/api/owner/mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile, otp })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) {
      _pfSetError("pfPhoneInput", "pfPhoneErr", data.error || "Invalid code. Try again.");
      return;
    }

    const saved = data.mobile || mobile;
    _ownerMobile = saved;
    if (_owner) _owner.mobile = saved;
    _pfPendingMobile = null;
    _pfRenderPhone();
    _pfSetError("pfPhoneInput", "pfPhoneErr", "");

    // The same number is on the User Info panel and gates the callback button,
    // so both are brought up to date rather than left showing "Not set" until
    // the next reload.
    const miMobile = document.getElementById("mi-mobile");
    if (miMobile) { miMobile.textContent = saved; miMobile.style.color = "#03162D"; }
    const miEdit = document.getElementById("mi-mobile-edit");
    if (miEdit) miEdit.style.display = "none";
    const alert = document.getElementById("mobile-missing-alert");
    if (alert) alert.style.display = "none";
    if (typeof renderActivity === "function") renderActivity(allRequests);
    // The identity card had been showing "Add your number". It is showing the
    // number now.
    renderProfileView();
  } catch {
    _pfSetError("pfPhoneInput", "pfPhoneErr", "Network error. Try again.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Verify"; }
  }
}

pfPhone.send()?.addEventListener("click", pfSendPhoneCode);
pfPhone.verify()?.addEventListener("click", pfVerifyPhoneCode);
// Enter in either box does the obvious next thing instead of submitting the
// whole form, which would try to save a profile that is not yet valid.
pfPhone.input()?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); pfSendPhoneCode(); }
});
pfPhone.otp()?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); pfVerifyPhoneCode(); }
});

pf.form()?.addEventListener("submit", saveProfile);
pf.dob()?.addEventListener("input", _pfSyncAge);
pf.dob()?.addEventListener("change", _pfSyncAge);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const sheet = pf.sheet();
  if (sheet && sheet.classList.contains("open")) { e.preventDefault(); closeProfile(); }
});
const grid      = document.getElementById("vehicleGrid");
const searchInp = document.getElementById("vehicleSearch");
let allTags      = [];
let allRequests  = [];
let _ownerMobile = null;
let _nbFilter    = null; // "active" | "premium" | "free" | "used" | null

// Which vehicle the activity feed is narrowed to, by tag token; null = all.
//
// Separate from _nbFilter on purpose. That one filters the vehicle list by
// plan state; this one answers a different question — "what happened to THIS
// car" — and an owner asking it should not lose their place in the list above.
let _actVehicle  = null;

// ── Burger menu state ─────────────────────────────────────────────
let _owner  = null;
let _userId = null;
let _selIdx = 0;


// ── UI strings (externalised for i18n) ───────────────────────────
const UI = {
  greetPrefix:    "Hi,",
  greetFallback:  "there",
  noVehicles:     "No vehicles yet",
  noVehiclesSub:  "Add your first vehicle below",
  loadError:      "Couldn't load your vehicles.",
  retry:          "Retry",
  refreshing:     "Refreshing…",
};

// ── Per-vehicle color palette ─────────────────────────────────────
const VEHICLE_COLORS = [
  { bg: "#FFE3DD", accent: "#FF2700" },  // red
  { bg: "#DBEAFE", accent: "#2563EB" },  // blue
  { bg: "#D1FAE5", accent: "#059669" },  // green
  { bg: "#EDE9FE", accent: "#7C3AED" },  // purple
  { bg: "#FEF3C7", accent: "#D97706" },  // amber
];

// ── Type labels ───────────────────────────────────────────────────
const VEHICLE_LABELS = {
  car: "Car", bike: "Bike", scooter: "Scooter",
  auto_rickshaw: "Auto Rickshaw", truck: "Truck",
  bus: "Bus"
};

// ── Type-specific vehicle artwork ────────────────────────────────
// The same six drawings the activation picker uses (VEHICLE_ICON_SRC in
// scripts/scanner/app.js), so the type someone picks when activating a tag is
// the icon they meet again here. <img> rather than inline SVG because the four
// road-vehicle files are raster inside an SVG wrapper; the consequence is that
// these no longer inherit the card's text colour.
const VEHICLE_ICON_SRC = {
  car: "/images/car-tag.svg",
  bike: "/images/bike-tag.svg",
  scooter: "/images/vtype-scooter.png",
  auto_rickshaw: "/images/vtype-auto.png",
  truck: "/images/vtype-truck.png",
  bus: "/images/vtype-bus.png"
};

const VEHICLE_SVGS = Object.fromEntries(
  Object.entries(VEHICLE_ICON_SRC).map(([type, src]) => [
    type,
    `<img src="${src}" alt="" width="28" height="28" decoding="async" aria-hidden="true" style="display:block;object-fit:contain">`
  ])
);

// HTML-escape any value before interpolating it into innerHTML. vehicleLabel
// and plateNumber are owner-supplied free text (from registration/claim/add-
// vehicle) with no character allowlist on the backend, so they can contain
// `<`, `"`, etc. They're rendered here via innerHTML (not textContent), so an
// unescaped value would execute as HTML/script in this owner's own dashboard.
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function iconFor(tag) {
  // tag.vehicleType from API, or tag.type from localStorage pending vehicles
  const t = tag.vehicleType || tag.type || "car";
  return VEHICLE_SVGS[t] || VEHICLE_SVGS.car;
}

const ADD_CARD = `
<a href="/register-owner" class="pt-vadd-lc" aria-label="Add a new vehicle">
  <div class="pt-vadd-lc-ic">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </div>
  <div>
    <p class="pt-vadd-lc-t">Add Vehicle</p>
    <p class="pt-vadd-lc-s">Register a new vehicle</p>
  </div>
</a>`;

function vehicleCard(tag, idx) {
  const colorIdx  = allTags.indexOf(tag);
  const color     = VEHICLE_COLORS[(colorIdx >= 0 ? colorIdx : idx) % VEHICLE_COLORS.length];
  const label     = tag.vehicleLabel || VEHICLE_LABELS[tag.type] || "Vehicle";
  const plate     = tag.plateNumber  || tag.number || tag.token || "—";
  const type      = tag.vehicleType  || tag.type   || "car";
  // Owner-supplied free text, HTML-escaped before it's placed inside markup
  // below (the raw `label`/`plate` are still used for URLSearchParams, which
  // does its own percent-encoding — escaping there would double-encode it).
  const labelSafe = esc(label);
  const plateSafe = esc(plate);
  const params    = new URLSearchParams({ number: plate, type, label, id: tag.id || "", token: tag.token || "" }).toString();
  const svg       = iconFor(tag);
  const isActive  = tag.status !== "inactive";
  const pill      = tag.premium ? "★ Premium" : (!tag.freeContactUsed ? "1 Free Call" : "Call Used");
  const pillClass = tag.premium ? "vp-premium" : (!tag.freeContactUsed ? "vp-free" : "vp-used");
  const detailUrl = `/owner-vehicle-detail?${params}`;
  // Card action row (both active and inactive cards). Three states (M18):
  //  • premium            → Download Premium Tag (official sticker)
  //  • free, contact used → "trial expired" note + Buy Premium Tag → shop
  //  • free, unused       → nothing (the free trial is still live)
  // Buttons stopPropagation so tapping them never navigates to the detail page.
  const isOfficial = Boolean(tag.premium);
  const hasId      = Boolean(tag.id);
  const trialExpired = !isOfficial && Boolean(tag.freeContactUsed);

  let actionsInner = "";
  if (hasId && isOfficial) {
    actionsInner = `<button class="pt-vlc-act dl" onclick="event.stopPropagation();downloadETagFor('${tag.id}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Download Premium Tag
      </button>`;
  } else if (hasId && trialExpired) {
    actionsInner = `<p class="pt-vlc-trial">Your free trial has ended, buy a premium tag to continue.</p>
      <button class="pt-vlc-act buy" onclick="event.stopPropagation();goToShopForReplace('${tag.id}')">Buy Premium Tag</button>`;
  }
  const actions = actionsInner ? `\n  <div class="pt-vlc-actions">${actionsInner}</div>` : "";

  return `
<div class="pt-vlc" style="border-left-color:${color.accent}">
  <div class="pt-vlc-main" role="link" tabindex="0"
       onclick="location.href='${detailUrl}'"
       onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();location.href='${detailUrl}'}"
       aria-label="${labelSafe}, ${plateSafe}, ${isActive ? "active" : "inactive"}">
    <div class="pt-vlc-icon" style="background:${color.bg};color:${color.accent}">${svg}</div>
    <div class="pt-vlc-body">
      <p class="pt-vlc-name">${labelSafe}</p>
      <p class="pt-vlc-plate">${plateSafe}</p>
    </div>
    <div class="pt-vlc-meta">
      <span class="pt-vlc-pill ${pillClass}">${pill}</span>
      <span class="pt-vlc-stxt${isActive ? " on" : ""}">${isActive ? "● Active" : "○ Inactive"}</span>
    </div>
    <span class="pt-vlc-arr"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>
  </div>
  ${actions}
</div>`;
}

function skeletonGrid(count = 3) {
  return Array.from({ length: count }, () => `
    <div class="pt-vlc" style="pointer-events:none">
      <div class="sk" style="width:48px;height:48px;border-radius:14px;flex-shrink:0"></div>
      <div style="flex:1">
        <div class="sk" style="height:14px;width:62%;border-radius:6px;margin-bottom:7px"></div>
        <div class="sk" style="height:11px;width:42%;border-radius:5px"></div>
      </div>
    </div>`).join("") + ADD_CARD;
}

const EMPTY_STATE = `
  <div role="status" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px 12px;text-align:center">
    <div aria-hidden="true" style="width:60px;height:60px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" stroke="#9CA3AF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="7" cy="7" r="1.5" fill="#9CA3AF"/>
      </svg>
    </div>
    <p style="font-size:.92rem;font-weight:800;color:#323232;margin:0 0 4px">${UI.noVehicles}</p>
    <p style="font-size:.8rem;color:#6B7280;margin:0">${UI.noVehiclesSub}</p>
  </div>`;

function getDisplayTags() {
  const q = searchInp ? searchInp.value.trim().toLowerCase() : "";
  let tags = allTags;
  if (_nbFilter) {
    tags = tags.filter(t => {
      if (_nbFilter === "active")  return t.status !== "inactive";
      if (_nbFilter === "premium") return t.premium;
      if (_nbFilter === "free")    return !t.premium && !t.freeContactUsed;
      if (_nbFilter === "used")    return !t.premium && t.freeContactUsed;
      return true;
    });
  }
  if (q) {
    tags = tags.filter(t =>
      (t.vehicleLabel || t.type || "").toLowerCase().includes(q) ||
      (t.plateNumber  || t.number || "").toLowerCase().includes(q)
    );
  }
  return tags;
}

const FILTER_EMPTY = `
  <div role="status" style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;padding:28px 16px 12px;text-align:center">
    <div aria-hidden="true" style="width:60px;height:60px;border-radius:50%;background:#FFF5F3;display:flex;align-items:center;justify-content:center;margin-bottom:12px">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="8" stroke="#FF2700" stroke-width="1.8"/>
        <path d="M21 21l-4.35-4.35" stroke="#FF2700" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </div>
    <p style="font-size:.92rem;font-weight:800;color:#323232;margin:0 0 4px">No matches</p>
    <p style="font-size:.8rem;color:#6B7280;margin:0">Try a different filter or search term</p>
  </div>`;

function renderGrid(tags, animate = false) {
  const isFiltered = _nbFilter || (searchInp && searchInp.value.trim());
  const empty = tags.length === 0 ? (isFiltered ? FILTER_EMPTY : EMPTY_STATE) : "";
  grid.innerHTML = empty + tags.map((t, i) => vehicleCard(t, i)).join("") + ADD_CARD;
  if (animate) {
    grid.classList.remove("pt-reveal-grid");
    void grid.offsetWidth;
    grid.classList.add("pt-reveal-grid");
  }
  const countEl = document.getElementById("tagsCount");
  if (countEl) {
    if (!allTags.length) {
      countEl.textContent = "";
    } else if (tags.length !== allTags.length) {
      countEl.textContent = `(${tags.length} of ${allTags.length})`;
    } else {
      countEl.textContent = `(${allTags.length})`;
    }
  }
}

// The Tags / Active / Premium chips have been taken out of the header, so
// there is nothing left to render there. The same three counts are still on
// the page, in the Overview section (see renderNoticeboard).

function renderNoticeboard(tags) {
  const nb = document.getElementById("noticeboard");
  if (!nb) return;

  const total    = tags.length;
  const active   = tags.filter(t => t.status !== "inactive").length;
  const premium  = tags.filter(t => t.premium).length;
  const freeLeft = tags.filter(t => !t.premium && !t.freeContactUsed).length;
  const used     = tags.filter(t => !t.premium &&  t.freeContactUsed).length;

  const ka = (key) => _nbFilter === key ? " nb-active" : "";
  const FILTER_NAMES = { active: "Active", premium: "Premium", free: "Free Calls Left", used: "Call Used" };

  const hd = `
<div class="pt-ov-hd">
  <h2 class="pt-ov-title">Overview</h2>
  <div class="pt-ov-bar"></div>
  <p class="pt-ov-sub">${total} Vehicle${total !== 1 ? "s" : ""} registered</p>
</div>
<div class="pt-ov-kpis">
  <div class="pt-ov-kpi${ka("active")}" data-filter="active" onclick="window.applyNbFilter('active')" title="Filter: Active">
    <div class="pt-ov-ki" style="background:#DCFCE7">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10B981" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn green">${active}</span>
    <div class="pt-ov-kl">Active Tags</div>
  </div>
  <div class="pt-ov-kpi${ka("premium")}" data-filter="premium" onclick="window.applyNbFilter('premium')" title="Filter: Premium">
    <div class="pt-ov-ki" style="background:#FEF3C7">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6L12 2z" stroke="#D97706" stroke-width="1.7" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn amber">${premium}</span>
    <div class="pt-ov-kl">Premium Tags</div>
  </div>
  <div class="pt-ov-kpi${ka("free")}" data-filter="free" onclick="window.applyNbFilter('free')" title="Filter: Free calls left">
    <div class="pt-ov-ki" style="background:#DBEAFE">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.36 2 2 0 0 1 3.59 1.18h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.73a16 16 0 0 0 6.36 6.36l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="#2563EB" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
    <span class="pt-ov-kn">${freeLeft}</span>
    <div class="pt-ov-kl">Free Calls Left</div>
  </div>
  <div class="pt-ov-kpi${ka("used")}" data-filter="used" onclick="window.applyNbFilter('used')" title="Filter: Call used">
    <div class="pt-ov-ki" style="background:#FEE2E2">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#EF4444" stroke-width="2"/><path d="M15 9l-6 6M9 9l6 6" stroke="#EF4444" stroke-width="2" stroke-linecap="round"/></svg>
    </div>
    <span class="pt-ov-kn${used ? " red" : ""}">${used}</span>
    <div class="pt-ov-kl">Calls Used</div>
  </div>
</div>
${_nbFilter ? `
<div class="pt-ov-fbar visible">
  <span>Filtered: <strong>${FILTER_NAMES[_nbFilter] || _nbFilter}</strong></span>
  <button class="pt-ov-fbar-clear" onclick="window.clearNbFilter()">✕ Clear</button>
</div>` : ""}`;

  if (total === 0) {
    nb.innerHTML = hd + `<div class="pt-ov-empty">Add your first vehicle to see your overview here.</div>`;
    return;
  }

  const tipIcon = freeLeft < total && !premium
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.4h7.6L12 2z" stroke="#D97706" stroke-width="1.8" stroke-linejoin="round"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#10B981" stroke-width="2"/><path d="M9 12l2 2 4-4" stroke="#10B981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const tipText = freeLeft < total && !premium
    ? `Upgrade to <strong>Premium</strong> for unlimited private contact. Your number stays hidden.`
    : `Each free E-Tag includes <strong>1 free contact</strong> via masked call or WhatsApp.`;

  // No Tag Status list. It restated the My Vehicles grid directly below it —
  // same plates, same status, same per-tag badge — so an owner scrolled past
  // every vehicle twice to reach anything else. The KPIs above still answer the
  // counting question and still filter that grid, which is where the detail
  // belongs; only the tip survives, because it is the one line here that says
  // something the cards do not.
  nb.innerHTML = hd + `
<div class="pt-ov-tip">
  <span class="pt-ov-tip-ic">${tipIcon}</span>
  <span>${tipText}</span>
</div>`;
}

// ── Activity section ──────────────────────────────────────────────
function formatTimeAgo(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The actual clock time a scanner made contact.
//
// "12 min ago" alone is fine for something you are looking at as it happens and
// useless afterwards: an owner reconstructing a missed call wants to know it
// came at 4:05 pm yesterday, not that it was "1d ago". Both are shown — the
// relative form still reads faster at a glance.
//
// Rendered in the viewer's own locale and timezone; the stored value is UTC ISO
// and converting it here is the only place that knows where the reader is.
function formatExactTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86400000);
  if (sameDay) return `Today ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}

// How much of the callback window is left, phrased for a glance.
//
// Rounded UP, so a window with forty seconds in it reads "1 min left" rather
// than "0 min left" while the button is still there and still works. Under a
// minute it stops counting and says so.
function callbackTimeLeft(target, now) {
  if (!target) return "";
  const msLeft = _callbackWindowMs - (now - new Date(target.createdAt).getTime());
  if (msLeft <= 0) return "";
  if (msLeft < 60000) return "less than a minute left";
  return `${Math.ceil(msLeft / 60000)} min left`;
}

// How long the two of them actually spoke, read as a person would say it.
//
// Returns "" for a call with no talk time, so the caller renders nothing rather
// than "0s" — a missed call already says "Missed", and pinning a duration of
// zero next to it is noise. Absent and zero both mean "nothing to show" here;
// the difference between them matters when DECIDING the outcome, which is done
// server-side in lib/core/call-outcome.js, not in this line.
function formatCallDuration(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 60) return `${n}s`;
  const m = Math.floor(n / 60);
  const s = n % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// How long a call may be returned for. Overwritten from the dashboard payload
// so the button and the route agree; this is only the fallback for a response
// that predates the field.
let _callbackWindowMs = 48 * 60 * 60 * 1000;

// A contact that no longer maps to a tag the owner holds — a deleted vehicle,
// or a tag transferred away. Grey rather than a palette colour, so it never
// impersonates one of the vehicles still in the list above.
const UNKNOWN_VEHICLE_COLOR = { bg: "#F3F4F6", accent: "#6B7280" };

// Which vehicle an activity row belongs to, in that vehicle's own colour.
//
// The index into allTags is what picks the colour, exactly as vehicleCard()
// does it — so a row in the feed and the card further up the page are the same
// shade of the same car. That correspondence is the whole feature: with three
// tags on one account, "someone contacted you" is not actionable until you
// know which windscreen they were standing at.
function vehicleOf(token) {
  const idx = allTags.findIndex(t => t.token === token);
  const tag = idx >= 0 ? allTags[idx] : null;
  return {
    tag,
    plate: tag ? (tag.plateNumber || tag.number || tag.token || "—") : "Unknown vehicle",
    color: tag ? VEHICLE_COLORS[idx % VEHICLE_COLORS.length] : UNKNOWN_VEHICLE_COLOR,
    icon:  tag ? iconFor(tag) : VEHICLE_SVGS.car,
  };
}

// The plate, as a plate: monospaced and letter-spaced so it reads as a
// registration rather than as a word in the sentence next to it.
function plateChip(v) {
  const icon = v.icon.replace(/width="28"/, 'width="13"').replace(/height="28"/, 'height="13"');
  const style = `background:${v.color.bg};color:${v.color.accent};border-color:${v.color.accent}33`;
  return `<span class="pt-act-plate" style="${style}">${icon}${esc(v.plate)}</span>`;
}

function hideActivityFilter() {
  const row = document.getElementById("actVehicleFilter");
  if (row) { row.style.display = "none"; row.innerHTML = ""; }
}

// Per-vehicle filter chips above the feed.
//
// Only drawn when at least two vehicles actually have activity — one car makes
// every chip a no-op, and a filter that can only ever return everything is
// noise. Counts are on the chips because "which car is getting scanned" is the
// question an owner opens this section to answer, and the answer should not
// require tapping through each one to find out.
function renderActivityFilter(recent) {
  const row = document.getElementById("actVehicleFilter");
  if (!row) return;

  const counts = new Map();
  for (const r of recent) counts.set(r.token, (counts.get(r.token) || 0) + 1);

  // A filter pinned to a vehicle that has since dropped out of the 48-hour
  // window would leave the owner staring at an empty feed with no clue why.
  // Falling back to "All" is the honest answer: there is nothing to show for
  // that car any more.
  if (_actVehicle !== null && !counts.has(_actVehicle)) _actVehicle = null;

  // allTags order, so chip colours run in the same sequence as the cards above.
  const withActivity = allTags.filter(t => counts.has(t.token));
  const orphanCount  = recent.length - withActivity.reduce((n, t) => n + counts.get(t.token), 0);

  if (withActivity.length + (orphanCount ? 1 : 0) < 2) {
    row.style.display = "none";
    row.innerHTML     = "";
    return;
  }

  // Chips address a vehicle by its index in allTags, never by interpolating the
  // token into the onclick. A token is server-generated and in practice
  // alphanumeric, but esc() turns a quote into `&#39;`, which the HTML parser
  // hands back to the JS parser as a real quote — escaping would not save an
  // attribute built this way. An integer cannot break out of anything.
  const chip = (idx, label, count, color, icon) => {
    const on = idx >= 0 ? _actVehicle === allTags[idx].token : _actVehicle === null;
    const style = on
      ? (idx >= 0 ? `background:${color.accent};border-color:${color.accent};color:#fff`
                  : "background:#03162D;border-color:#03162D;color:#fff")
      : "";
    const ic = icon ? icon.replace(/width="28"/, 'width="14"').replace(/height="28"/, 'height="14"') : "";
    return `<button class="pt-act-vchip${on ? " active" : ""}" style="${style}"
      aria-pressed="${on}" onclick="filterActivityBy(${idx})">
      ${ic}${esc(label)}<span class="pt-act-vchip-n">${count}</span></button>`;
  };

  const all = chip(-1, "All", recent.length, null, null);

  const chips = withActivity.map(t => {
    const idx = allTags.indexOf(t);
    const v   = vehicleOf(t.token);
    return chip(idx, v.plate, counts.get(t.token), v.color, v.icon);
  });

  row.style.display = "flex";
  row.innerHTML = all + chips.join("");
}

// Chips call this with an index into allTags, or -1 for "All". It only swaps
// the filter and repaints from data already in memory, so switching vehicles
// costs no network round-trip.
function filterActivityBy(idx) {
  const tag = idx >= 0 ? allTags[idx] : null;
  // Tapping the vehicle you are already filtered to clears the filter, the way
  // the noticeboard tiles above already behave.
  const next = tag ? tag.token : null;
  _actVehicle = (next !== null && _actVehicle === next) ? null : next;
  renderActivity(allRequests);
}
window.filterActivityBy = filterActivityBy;

function renderActivity(requests) {
  const container = document.getElementById("actCards");
  const badge     = document.getElementById("actBadge");
  if (!container) return;

  if (!requests || !requests.length) {
    container.innerHTML = `
      <div class="pt-act-empty">
        <div class="pt-act-empty-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="pt-act-empty-t">No activity yet</p>
        <p class="pt-act-empty-s">Contact requests from scanners will appear here</p>
      </div>`;
    if (badge) badge.style.display = "none";
    hideActivityFilter();
    return;
  }

  const now        = Date.now();
  const WIN_MS     = 60 * 60 * 1000;
  const TWO_DAYS   = 48 * 60 * 60 * 1000;

  // Only show entries from the last 2 days
  const recent = requests.filter(r =>
    (now - new Date(r.createdAt).getTime()) <= TWO_DAYS
  );

  // Is this contact returnable at all?
  //
  // Two separate spans, and keeping them apart is the point. The list shows 48
  // hours of history; a callback lasts ten minutes. Seeing who called is not
  // the same permission as ringing them back.
  //
  // "NOT answered", never "is missed". Exotel's status callback has never been
  // configured, so callOutcome is null on every call in the database; gating on
  // `=== "missed"` would hide the button from all of them. Unknown means keep
  // offering it.
  //
  // Keyed on having a number, not on the contact being a call — a WhatsApp
  // report that left a callback number is returnable too. Anonymous rows get
  // nothing, because there is nobody to dial.
  // One rule, three answers, and it lives in callback-eligibility.js so it can
  // be tested on its own rather than inferred from this page. Calling back is a
  // premium feature and premium belongs to the TAG, not the account — the same
  // way contactAvailable and unlimitedContact already work. The server enforces
  // the identical rule; this only decides which controls get drawn.
  const stateOf = (r) =>
    callbackState(r, { tags: allTags, now, windowMs: _callbackWindowMs });

  const isReturnable = (r) => stateOf(r) === CALLABLE;

  // Everything a callback needs except the premium tag. Worth telling apart,
  // because the alternative is an owner who never finds out the feature exists:
  // the row would simply have no button and nothing to explain why.
  const blockedOnlyByPremium = (r) => stateOf(r) === NEEDS_PREMIUM;

  // Owns the premium tag already; the call window on it has closed. A separate
  // nudge because sending them to the shop to buy a sticker they are holding is
  // the kind of prompt that reads as a bug.
  const blockedOnlySubscription = (r) => stateOf(r) === NEEDS_SUBSCRIPTION;

  // Exactly one row may be called back: the newest returnable one.
  //
  // `recent` is already sorted newest-first by the server, so the first hit is
  // the live conversation. Offering the others would ring people who reported
  // something earlier and have since moved on, while the person still waiting
  // gets no priority at all.
  const callbackTarget = recent.find(isReturnable) || null;
  const canCallBack = (r) => callbackTarget !== null && r.id === callbackTarget.id;

  // The banner and the row now point at the same contact. They used to disagree
  // — the banner had its own 60-minute idea of "urgent" while the rows had
  // another — so the page could show a prompt to call somebody back above a
  // list where that row had no button.
  const eligible = callbackTarget;

  // Count how many are within the window (actionable)
  const hotCount = recent.filter(r =>
    (now - new Date(r.createdAt).getTime()) <= WIN_MS
  ).length;

  if (badge) {
    badge.textContent    = hotCount;
    badge.style.display  = hotCount ? "inline-block" : "none";
  }

  // ── Callback prompt (after Overview) ──────────────────────────
  const prompt = document.getElementById("callbackPrompt");
  if (prompt) {
    if (eligible) {
      const ageMs  = Date.now() - new Date(eligible.createdAt).getTime();
      const v      = vehicleOf(eligible.token);
      const masked = eligible.phone ? `•••• ${String(eligible.phone).slice(-4)}` : "Unknown caller";
      const cta    = _ownerMobile
        ? `<button class="pt-act-cta" id="cbBtnPrompt" onclick="callBack('cbBtnPrompt')" style="flex-shrink:0">Call Back</button>`
        : `<span class="pt-act-nophone" style="flex-shrink:0">Add phone<br>to call back</span>`;
      prompt.style.display = "block";
      prompt.innerHTML = `
<div class="pt-cb-prompt">
  <div class="pt-cb-prompt-hd">
    <span class="pt-cb-pulse"></span>
    <span class="pt-cb-prompt-label">Someone wants you to call back</span>
    <!-- The window is ten minutes and the button removes itself when it ends.
         Saying how long is left turns that from something that vanished into
         something that expired. -->
    <span class="pt-cb-prompt-left">${esc(callbackTimeLeft(eligible, now))}</span>
  </div>
  <div class="pt-act-card urgent" style="margin:0;border-radius:14px">
    <div class="pt-act-ic" style="background:#FFE3DD;color:#FF2700">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="1.8"/></svg>
    </div>
    <div class="pt-act-body">
      <p class="pt-act-who">${esc(masked)} contacted you</p>
      <p class="pt-act-det">${plateChip(v)}<span>Call</span></p>
      <p class="pt-act-time">${formatTimeAgo(ageMs)}</p>
    </div>
    ${cta}
  </div>
</div>`;
    } else {
      prompt.style.display = "none";
      prompt.innerHTML = "";
    }
  }

  const callSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="1.8"/></svg>`;
  const waSvg  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // Smaller than the row icons above: this sits inside the body as a marker for
  // a line of text, not as the card's own symbol.
  const pinSvg = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="2"/></svg>`;

  if (!recent.length) {
    container.innerHTML = `
      <div class="pt-act-empty">
        <div class="pt-act-empty-ic">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="#D1D5DB" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <p class="pt-act-empty-t">No recent activity</p>
        <p class="pt-act-empty-s">Activity older than 2 days is hidden</p>
      </div>`;
    if (badge) badge.style.display = "none";
    hideActivityFilter();
    return;
  }

  // Chips are built from the whole window, not from what the filter leaves —
  // otherwise selecting a vehicle would erase every other chip and strand the
  // owner with no way back.
  renderActivityFilter(recent);
  const visible = _actVehicle === null
    ? recent
    : recent.filter(r => r.token === _actVehicle);

  const cards = visible.slice(0, 20).map(r => {
    const ageMs  = now - new Date(r.createdAt).getTime();
    const within = ageMs <= WIN_MS;
    const isCall = r.action === "call";
    const isElig = r === eligible;

    // Match token → vehicle, and carry its colour into the row
    const v      = vehicleOf(r.token);
    const masked = r.phone ? `•••• ${String(r.phone).slice(-4)}` : "Unknown caller";

    let cardCls, icBg, icCol;
    if (isElig)              { cardCls = "urgent"; icBg = "#FFE3DD"; icCol = "#FF2700"; }
    else if (isCall && within) { cardCls = "call";   icBg = "#DBEAFE"; icCol = "#2563EB"; }
    else if (!isCall)        { cardCls = "wa";     icBg = "#DCFCE7"; icCol = "#16A34A"; }
    else                     { cardCls = "idle";   icBg = "#F3F4F6"; icCol = "#9CA3AF"; }

    // Call result badge.
    //
    // Driven by the normalised callOutcome, not by Exotel's own wording. This
    // used to test for `callResult === "connected"` — a value Exotel does not
    // send; it says "completed" — so the first genuinely answered call would
    // have been labelled "Failed". Nobody caught it because the status callback
    // has never fired, so the branch has never run.
    let resultBadge = "";
    if (isCall && r.callOutcome) {
      const label = r.callOutcome === "answered" ? "Answered"
                  : r.callOutcome === "missed"   ? "Missed" : "Failed";
      const bg    = r.callOutcome === "answered"
        ? "background:#DCFCE7;color:#14532D"
        : "background:#FEE2E2;color:#B91C1C";
      resultBadge = `<span class="pt-act-det-badge" style="${bg}">${label}</span>`;
      const spoken = formatCallDuration(r.callDuration);
      if (spoken) {
        resultBadge += `<span style="color:#9CA3AF;font-size:.67rem">${esc(spoken)}</span>`;
      }
    }
    if (!isCall && r.status) {
      const label = r.status === "delivered" ? "Delivered" : r.status === "pending" ? "Pending" : r.status;
      resultBadge = `<span class="pt-act-det-badge" style="background:#DCFCE7;color:#14532D">${label}</span>`;
    }

    // CTA. Every returnable call gets one now, not just the newest — with two
    // scanners in a day, the older one used to be unreachable no matter how
    // recently it happened.
    let cta = "";
    if (blockedOnlyByPremium(r)) {
      // Same slot and same treatment as the "Add phone" nudge above it: this is
      // the one thing standing between the owner and reaching this person, so
      // it says so and goes straight to where that is fixed.
      cta = `<button class="pt-act-nophone pt-act-upsell" onclick="switchTab('shop')"
        title="Callback is available on premium tags">Premium<br>to call back</button>`;
    } else if (blockedOnlySubscription(r)) {
      // Same slot and treatment, different destination: this owner already has
      // the tag, so the thing standing in the way is the subscription.
      cta = `<button class="pt-act-nophone pt-act-upsell" onclick="switchTab('shop')"
        title="Your call service for this vehicle has ended">Renew<br>to call back</button>`;
    } else if (canCallBack(r)) {
      if (!_ownerMobile) {
        cta = `<span class="pt-act-nophone">Add phone<br>to call back</span>`;
      } else {
        // id carries the row so the handler can name it to the server, and so
        // the button it disables is this one rather than the first on the page.
        const btnId = `cbBtn-${r.id}`;
        cta = `<button class="pt-act-cta" id="${btnId}" data-request-id="${esc(r.id)}"
          onclick="callBack('${esc(btnId)}')">${isElig ? "Call Back" : "Call"}</button>`;
      }
    }

    // Where they contacted from, when the row carries it. Absent on rows from
    // before this shipped, on tags that were not entitled, and on addresses no
    // provider could place — all of which render as nothing rather than as
    // "Unknown", because a missing city is not a fact worth a line of its own.
    //
    // The label is built server-side so this page and the admin console cannot
    // describe the same row differently. Escaped like any other third-party
    // string: it originates from a geo provider, not from us.
    const locLine = r.scannerLocationLabel
      ? `<p class="pt-act-loc" title="Approximate area, from the scanner's network connection">${pinSvg}<span>${esc(r.scannerLocationLabel)}</span></p>`
      : "";

    return `
<div class="pt-act-card ${cardCls}">
  <div class="pt-act-ic" style="background:${icBg};color:${icCol}">${isCall ? callSvg : waSvg}</div>
  <div class="pt-act-body">
    <p class="pt-act-who">${esc(masked)} contacted you</p>
    <p class="pt-act-det">${plateChip(v)}<span>${isCall ? "Call" : "WhatsApp"}</span>${resultBadge}</p>
    ${locLine}
    <p class="pt-act-time" title="${esc(new Date(r.createdAt).toLocaleString())}">${esc(formatExactTime(r.createdAt))} · ${formatTimeAgo(ageMs)}</p>
  </div>
  ${cta}
</div>`;
  }).join("");

  container.innerHTML = cards;

  scheduleCallbackExpiry(callbackTarget, now);
}

// Take the button away the moment the ten minutes are up.
//
// Nothing here reloads on its own, so a dashboard left open kept offering a
// callback long after the server would honour it — the owner taps, waits, and
// gets an error for something the page told them they could do. A window that
// closes silently is worse than a short one.
//
// Re-renders from the same data rather than refetching: the only thing that
// changed is the clock, and isReturnable is evaluated against `now` each pass.
let _callbackExpiryTimer = null;
function scheduleCallbackExpiry(target, now) {
  if (_callbackExpiryTimer) {
    clearTimeout(_callbackExpiryTimer);
    _callbackExpiryTimer = null;
  }
  if (!target) return;

  const msLeft = _callbackWindowMs - (now - new Date(target.createdAt).getTime());
  if (msLeft <= 0) return;

  // A second past the boundary, so the re-render lands on the far side of it
  // rather than racing the comparison it is about to make.
  _callbackExpiryTimer = setTimeout(() => {
    _callbackExpiryTimer = null;
    renderActivity(allRequests);
  }, msLeft + 1000);
}

// Will `tel:` actually reach a dialer here?
//
// Capability, not user-agent. A coarse pointer with no hover is a touchscreen,
// which in practice is a device that can place a call; a mouse-driven browser
// generally cannot, and navigating it to `tel:` either does nothing or raises
// an "open with…" prompt for an app the person does not have.
//
// Wrong either way is survivable, which is why it is safe to guess: the sheet
// carries the number regardless, so a touch laptop that guesses wrong shows a
// number nobody needed, and a phone that guesses wrong shows a number the
// owner can simply tap.
function deviceCanDial() {
  try {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  } catch {
    return false;
  }
}

// The number, big enough to read off a screen and copy from.
//
// It is the SAME virtual number every time, not a per-call one — what makes
// this call reach the scanner is the pending_calls row the route just wrote,
// keyed to the owner's own mobile. So it must be dialled from the phone that
// number belongs to, and within ten minutes, and the sheet says both. Someone
// who dials it from a different handset gets nowhere, which is not obvious
// unless we tell them.
function openCallSheet(virtualNumber) {
  const bd = document.getElementById("ptCallBackdrop");
  const sh = document.getElementById("ptCallSheet");
  const body = document.getElementById("ptCallBody");
  if (!bd || !sh || !body) return;

  const pretty = String(virtualNumber);
  const fromNumber = _ownerMobile ? String(_ownerMobile) : null;

  body.innerHTML = `
<div style="text-align:center;padding:4px 0 8px">
  <div style="width:46px;height:46px;border-radius:14px;background:#FFE3DD;color:#FF2700;
              display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.17h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.86a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" stroke-width="1.8"/></svg>
  </div>
  <p style="font-weight:800;font-size:1.02rem;color:#111;margin:0 0 4px">Call this number to connect</p>
  <p class="pt-snote" style="margin:0 0 16px">
    We'll join you to the person who contacted you. Neither of you sees the other's number.
  </p>

  <a href="tel:${esc(pretty)}" id="cbSheetDial"
     style="display:block;font-size:1.5rem;font-weight:800;letter-spacing:0.04em;color:#111;
            text-decoration:none;background:#F7F8FA;border:1px solid #E5E7EB;border-radius:14px;
            padding:14px 12px;margin-bottom:10px">${esc(pretty)}</a>

  <!-- Number passed by data attribute, not interpolated into the onclick.
       esc() renders a quote as &#39;, which the HTML parser decodes back to a
       real quote before JS sees it — inside an inline handler that closes the
       string early. An attribute value decodes safely. -->
  <button type="button" id="cbCopyBtn" data-number="${esc(pretty)}" onclick="copyCallNumber()"
          style="width:100%;background:#111;color:#fff;border:none;border-radius:12px;
                 padding:13px;font-weight:700;font-size:.9rem;cursor:pointer;font-family:inherit">
    Copy number
  </button>

  <div style="text-align:left;background:#FFF9F8;border:1px solid #FFE3DD;border-radius:12px;
              padding:12px 14px;margin-top:14px">
    <p style="margin:0 0 6px;font-size:.78rem;font-weight:700;color:#B91C1C">Two things to know</p>
    <p style="margin:0 0 4px;font-size:.78rem;line-height:1.5;color:#6B7280">
      Call from ${fromNumber ? `<strong style="color:#374151">${esc(fromNumber)}</strong>` : "the mobile number on your ParkTag account"} — we match the call to you by the number you dial from.
    </p>
    <p style="margin:0;font-size:.78rem;line-height:1.5;color:#6B7280">
      This connection stays open for <strong style="color:#374151">10 minutes</strong>. After that, tap Call Back again.
    </p>
  </div>

  <button type="button" onclick="closeCallSheet()"
          style="width:100%;background:none;border:none;color:#6B7280;font-weight:600;
                 font-size:.85rem;padding:14px 0 4px;cursor:pointer;font-family:inherit">Done</button>
</div>`;

  bd.classList.add("open");
  sh.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeCallSheet() {
  const bd = document.getElementById("ptCallBackdrop");
  const sh = document.getElementById("ptCallSheet");
  if (bd) bd.classList.remove("open");
  if (sh) sh.classList.remove("open");
  document.body.style.overflow = "";
}
window.closeCallSheet = closeCallSheet;

// Clipboard, with a fallback. navigator.clipboard is undefined on a page served
// over plain http and can reject when the document is not focused, and this
// button existing at all is the desktop half of the fix — so it must not be the
// thing that fails silently.
async function copyCallNumber() {
  const btn = document.getElementById("cbCopyBtn");
  const number = btn?.dataset?.number || "";
  if (!number) return;
  const done = () => {
    if (btn) {
      btn.textContent = "Copied";
      setTimeout(() => { if (btn) btn.textContent = "Copy number"; }, 1800);
    }
  };

  try {
    await navigator.clipboard.writeText(number);
    done();
    return;
  } catch { /* fall through */ }

  try {
    const scratch = document.createElement("textarea");
    scratch.value = number;
    scratch.setAttribute("readonly", "");
    scratch.style.position = "fixed";
    scratch.style.opacity = "0";
    document.body.appendChild(scratch);
    scratch.select();
    document.execCommand("copy");
    document.body.removeChild(scratch);
    done();
  } catch {
    // Nothing copied and nothing pretended — the number is on screen to read.
    _toast("Couldn't copy. The number is shown above.", "err");
  }
}
window.copyCallNumber = copyCallNumber;

async function callBack(btnId = "cbBtn") {
  const btn = document.getElementById(btnId);
  const label = btn?.textContent || "Call Back";
  if (btn) { btn.disabled = true; btn.textContent = "Calling…"; }
  try {
    // Name the row when the button came from one. The banner button carries no
    // id and the server falls back to the most recent contact, which is what it
    // has always done.
    const requestId = btn?.dataset?.requestId || null;
    const res = await fetch("/api/owner/callback/register-call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestId ? { requestId } : {})
    });
    const data = await res.json();
    if (data.ok && data.virtualNumber) {
      // Put the number on screen FIRST, then try the dialer.
      //
      // The old order was dialer-only: on a phone that is invisible and fine,
      // but `tel:` does nothing in most desktop browsers, so the button sat
      // reading "Opening dialer…" forever and the number it wanted dialled was
      // never shown. The route had already registered the call and it expired
      // ten minutes later, unused and unexplained.
      openCallSheet(data.virtualNumber);
      if (btn) { btn.disabled = false; btn.textContent = label; btn.classList.remove("ok"); }
      if (deviceCanDial()) {
        setTimeout(() => { window.location.href = `tel:${data.virtualNumber}`; }, 120);
      }
    } else if (data.code === "PREMIUM_REQUIRED") {
      // A stale tab, or a tag that stopped being premium since the page loaded.
      // Re-rendering swaps the button for the upgrade nudge.
      _toast("Calling back is a premium feature. Upgrade this vehicle to use it.", "err");
      renderActivity(allRequests);
    } else if (data.code === "NO_PHONE") {
      _toast("Add your mobile number to your profile to enable callback.", "err");
      if (btn) { btn.disabled = false; btn.textContent = label; }
    } else if (data.code === "CALLBACK_WINDOW_EXPIRED") {
      _toast("The 10-minute callback window has passed.", "err");
      renderActivity(allRequests); // re-render to remove the button
    } else if (data.code === "CALLBACK_NOT_LATEST") {
      // Another contact arrived while this page sat open, so the row that was
      // offered is no longer the newest. Re-rendering moves the button to the
      // one the server will actually honour.
      _toast("Someone else has contacted you since. Showing the latest.", "err");
      renderActivity(allRequests);
    } else {
      _toast(data.error || "Couldn't initiate callback. Try again.", "err");
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  } catch {
    _toast("Network error. Please try again.", "err");
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
window.callBack = callBack;

// The callback mobile is the number the masked-call feature dials, so it can't
// be saved on trust — the owner must prove control of it with an OTP. Step 1
// (saveMobile) sends the code; step 2 (verifyMobileOtp) verifies it and saves.
function _miMobileFromInput() {
  const raw = (document.getElementById("mi-mobile-input")?.value || "").trim().replace(/\D/g, "");
  if (!raw || raw.length < 10) return null;
  return raw.length === 10 ? `+91${raw}` : `+${raw}`;
}
function _miStatus(msg, color) {
  const status = document.getElementById("mi-mobile-status");
  if (status) { status.textContent = msg; status.style.color = color; status.style.display = "block"; }
}

// Number being verified — set when the code is sent, so the verify step uses
// the exact same number the OTP was sent to.
let _miPendingMobile = null;

async function saveMobile() {
  const mobile = _miMobileFromInput();
  if (!mobile) { _miStatus("Enter a valid 10-digit number.", "#DC2626"); return; }

  const btn = document.getElementById("mi-mobile-send");
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const res  = await fetch("/api/owner/mobile/send-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile })
    });
    const data = await res.json();
    if (data.ok) {
      _miPendingMobile = mobile;
      const otpRow = document.getElementById("mi-mobile-otp-row");
      if (otpRow) otpRow.style.display = "flex";
      document.getElementById("mi-mobile-otp-input")?.focus();
      _miStatus(`Code sent to ${mobile}. Enter it below to confirm.`, "#16A34A");
    } else {
      _miStatus(data.error || "Could not send the code.", "#DC2626");
    }
  } catch {
    _miStatus("Network error. Try again.", "#DC2626");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Send code"; }
  }
}
window.saveMobile = saveMobile;

async function verifyMobileOtp() {
  const otp = (document.getElementById("mi-mobile-otp-input")?.value || "").trim();
  const mobile = _miPendingMobile || _miMobileFromInput();
  if (!mobile) { _miStatus("Enter a valid 10-digit number.", "#DC2626"); return; }
  if (!/^\d{6}$/.test(otp)) { _miStatus("Enter the 6-digit code.", "#DC2626"); return; }

  try {
    const res  = await fetch("/api/owner/mobile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile, otp })
    });
    const data = await res.json();
    if (data.ok) {
      const saved = data.mobile || mobile;
      _ownerMobile = saved;
      _miPendingMobile = null;
      const mobileEl = document.getElementById("mi-mobile");
      if (mobileEl) { mobileEl.textContent = saved; mobileEl.style.color = "#03162D"; }
      const mobileEdit = document.getElementById("mi-mobile-edit");
      if (mobileEdit) mobileEdit.style.display = "none";
      const otpRow = document.getElementById("mi-mobile-otp-row");
      if (otpRow) otpRow.style.display = "none";
      const mobileAlert = document.getElementById("mobile-missing-alert");
      if (mobileAlert) mobileAlert.style.display = "none";
      _miStatus("Phone number verified and saved.", "#16A34A");
      _toast("Phone number verified. Call Back is now enabled.", "ok");
      renderActivity(allRequests);
    } else {
      _miStatus(data.error || "Invalid code. Try again.", "#DC2626");
    }
  } catch {
    _miStatus("Network error. Try again.", "#DC2626");
  }
}
window.verifyMobileOtp = verifyMobileOtp;

// ── Notice board KPI filter ───────────────────────────────────────
function applyNbFilter(key) {
  if (_nbFilter === key) { clearNbFilter(); return; }
  _nbFilter = key;
  renderGrid(getDisplayTags());
  renderNoticeboard(allTags);
  const bar = document.getElementById("mainFilterBar");
  const lbl = document.getElementById("mainFilterLabel");
  if (bar && lbl) {
    const names = { active: "Active", premium: "Premium", free: "Free Calls Left", used: "Call Used" };
    lbl.textContent = names[key] || key;
    bar.classList.add("visible");
  }
}

function clearNbFilter() {
  _nbFilter = null;
  renderGrid(getDisplayTags());
  renderNoticeboard(allTags);
  const bar = document.getElementById("mainFilterBar");
  if (bar) bar.classList.remove("visible");
}

window.applyNbFilter = applyNbFilter;
window.clearNbFilter = clearNbFilter;

// ── Search filter ─────────────────────────────────────────────────
searchInp.addEventListener("input", () => {
  renderGrid(getDisplayTags());
});

// ── User-scoped localStorage helpers ─────────────────────────────
function userKey(userId) {
  return "pt_vehicles_" + (userId || "").replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

function readSavedVehicles(userId) {
  try {
    const raw = localStorage.getItem(userKey(userId));
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function mergePendingVehicles(userId) {
  try {
    const pending = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
    if (!pending.length) return;
    const saved = readSavedVehicles(userId);
    const savedNums = new Set(saved.map(v => (v.number || "").toUpperCase()));
    const merged = [...saved, ...pending.filter(v => !savedNums.has((v.number || "").toUpperCase()))];
    localStorage.setItem(userKey(userId), JSON.stringify(merged));
    localStorage.removeItem("pt_pending_vehicles");
  } catch {}
}

// ── Auto-sync localStorage-only vehicles to the DB ───────────────
// Fires silently after the grid renders. For each vehicle that exists only in
// localStorage (e.g. API save failed during registration, or DB was reseeded),
// it retries POST /api/owner/local-vehicle. On success the vehicle gets a real
// token + QR; the localStorage entry is removed and the grid re-renders with
// the real tag data.
async function syncLocalVehicles(localVehicles, userId) {
  let synced = false;
  for (const v of localVehicles) {
    const number = (v.number || v.plateNumber || "").trim().toUpperCase();
    const type   = v.type || v.vehicleType || null;
    if (!number) continue;
    try {
      const res = await fetch("/api/owner/local-vehicle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, number })
      });
      if (res.ok || res.status === 409) {
        try {
          const key = userKey(userId);
          const arr = JSON.parse(localStorage.getItem(key) || "[]");
          localStorage.setItem(key, JSON.stringify(arr.filter(s => (s.number || "").toUpperCase() !== number)));
        } catch {}
        try {
          const arr = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
          localStorage.setItem("pt_pending_vehicles", JSON.stringify(arr.filter(s => (s.number || "").toUpperCase() !== number)));
        } catch {}
        synced = true;
      }
    } catch {}
  }
  if (!synced) return;
  try {
    const res = await fetch("/api/owner/dashboard");
    if (!res.ok) return;
    const data = await res.json();
    const seen = new Set();
    allTags = (data.tags || []).filter(t => {
      const p = (t.plateNumber || "").toUpperCase();
      if (!p || seen.has(p)) return false;
      seen.add(p);
      return true;
    });
    renderGrid(getDisplayTags(), true);
    renderNoticeboard(allTags);
  } catch {}
}

// ── Load data ─────────────────────────────────────────────────────
async function load() {
  grid.innerHTML = skeletonGrid(3);
  try {
    const res = await fetch("/api/owner/dashboard");
    if (res.status === 401 || res.status === 403) {
      window.location.href = "/owner-login";
      return;
    }
    if (!res.ok) {
      grid.innerHTML = ADD_CARD;
      return;
    }

    const data = await res.json();

    // Derive a stable user identifier from the session.
    //
    // Email or mobile only. This used to fall back to the owner's ObjectId, but
    // the server no longer sends it — it is the id every owner route keys off,
    // and no page needs it. The fallback could not fire in any case: an account
    // with neither an email nor a mobile has no way to sign in, so it cannot be
    // the one reading this.
    const userId = data.owner ? (data.owner.email || data.owner.mobile || "") : null;

    if (data.owner) {
      // The server decides the name now: what the owner set, then the recipient
      // name off their delivery address, then a cautious read of the email. The
      // guessing that used to live here turned "info@" into "Hi Info" — a wrong
      // answer stated confidently. A null greetingName means we genuinely do not
      // know, and "Hi there" plus the inline field is the honest response.
      const firstName = data.owner.greetingName || UI.greetFallback;
      // Echo the identifier they signed in with. Ranking email first showed an
      // e-mail address to people who had signed in with their phone number —
      // and on an account carrying somebody else's address, that reads as
      // being logged into the wrong account.
      //
      // DISPLAY ONLY. `userId` above stays on the old email-then-mobile basis
      // because it keys the `pt_vehicles_*` localStorage entries — deriving it
      // from the sign-in identifier instead would silently orphan every saved
      // vehicle the moment somebody switched sign-in method.
      const id = data.owner.signInIdentifier || data.owner.email || data.owner.mobile || "";
      renderGreetingAffordance(data.owner);
      greetName.textContent = `${UI.greetPrefix} ${firstName}!`;
      greetName.classList.remove("pt-reveal");
      void greetName.offsetWidth; // force reflow to re-trigger animation
      greetName.classList.add("pt-reveal");
      if (id) {
        greetId.textContent = id;
        greetId.classList.remove("pt-reveal");
        void greetId.offsetWidth;
        greetId.classList.add("pt-reveal");
      }

      // Populate burger menu owner header
      _owner       = data.owner;
      _ownerMobile = data.owner.mobile || null;
      _userId = userId;
      // The shop checkout used to read the owner's name, e-mail and mobile off
      // a `window.__ptOwner` global set here, which then sat on the page for the
      // rest of the session within reach of every script running on it —
      // Razorpay's checkout.js among them. create-order and cod-prepay-order
      // now return those details with the order being paid for, so they exist
      // for the length of a checkout rather than a session.
      const mName = document.getElementById("menuName");
      const mId   = document.getElementById("menuId");
      const mAv   = document.getElementById("menuAvatar");
      if (mName) mName.textContent = firstName;
      if (mId)   mId.textContent   = id;
      if (mAv)   mAv.textContent   = firstName.charAt(0).toUpperCase();
    }

    // One-time migration: move the old unscoped key into pending so it gets claimed below
    try {
      const legacy = localStorage.getItem("pt_saved_vehicles");
      if (legacy) {
        const cur = JSON.parse(localStorage.getItem("pt_pending_vehicles") || "[]");
        const legacyArr = JSON.parse(legacy);
        const curNums = new Set(cur.map(v => (v.number || "").toUpperCase()));
        const merged = [...cur, ...legacyArr.filter(v => !curNums.has((v.number || "").toUpperCase()))];
        localStorage.setItem("pt_pending_vehicles", JSON.stringify(merged));
        localStorage.removeItem("pt_saved_vehicles");
      }
    } catch {}

    // Persist userId so register-owner.js can write directly to the right key
    if (userId) sessionStorage.setItem("pt_uid", userId);

    // Absorb any vehicles added during register flow into THIS user's store
    if (userId) mergePendingVehicles(userId);

    // Read only THIS user's saved vehicles
    const saved   = userId ? readSavedVehicles(userId) : [];
    const apiTags = data.tags || [];
    // Dedup by _id first, fall back to plate number
    const apiIds  = new Set(apiTags.map(t => String(t._id || "")).filter(Boolean));
    const apiNums = new Set(apiTags.map(t => (t.plateNumber || "").toUpperCase()).filter(Boolean));
    const localOnly = saved.filter(v =>
      !(v._id && apiIds.has(String(v._id))) &&
      !apiNums.has((v.number || "").toUpperCase())
    );

    // Dedup apiTags themselves by plate number (handles stale DB duplicates)
    const seenPlates = new Set();
    const dedupedApi = apiTags.filter(t => {
      const plate = (t.plateNumber || t.number || "").toUpperCase();
      if (!plate || seenPlates.has(plate)) return false;
      seenPlates.add(plate);
      return true;
    });

    allTags     = [...localOnly, ...dedupedApi];
    allRequests = data.requests || [];
    // Take the window from the server so the button and the route it calls
    // agree. Older responses omit it and keep the built-in default.
    if (typeof data.callbackWindowMs === "number" && data.callbackWindowMs > 0) {
      _callbackWindowMs = data.callbackWindowMs;
    }
    renderGrid(getDisplayTags(), true);
    renderNoticeboard(allTags);
    renderActivity(allRequests);
    // The identity card reads _owner, which only exists from the line above.
    // Without this it kept whatever the markup shipped with — and switchTab is
    // the only other thing that draws it, so an owner who tapped Profile while
    // this request was still in flight was left looking at "ParkTag User" and
    // "Add your number" for the rest of the session.
    renderProfileView();
    if (localOnly.length > 0) syncLocalVehicles(localOnly, userId);
  } catch (error) {
    // This used to be a bare `catch {}`. Every failure in the whole block —
    // a network fault, a bad payload, a typo in a render helper — surfaced as
    // the same "Couldn't load your vehicles." with no way to tell which, so a
    // rendering bug was indistinguishable from the API being down.
    console.error("[owner dashboard] load failed:", error);
    grid.innerHTML = `
      <div role="alert" style="grid-column:1/-1;text-align:center;padding:28px 16px 12px">
        <p style="font-size:.9rem;font-weight:700;color:#374151;margin:0 0 10px">${UI.loadError}</p>
        <button onclick="load()"
          style="background:#FF2700;color:#fff;border:none;border-radius:10px;
                 padding:9px 22px;font-size:.85rem;font-weight:700;cursor:pointer;font-family:inherit">
          ${UI.retry}
        </button>
      </div>` + ADD_CARD;
  }
}

// Show skeleton immediately so layout is stable before API responds
if (grid) grid.innerHTML = skeletonGrid(3);
load();
window._reloadDashboard = load;

// Deep-link from the vehicle-detail page: /owner-welcome?shop=1&replace=<tagId>
// opens the shop with the trial tag remembered as the replace-context (M18).
//
// The same opener finishes the public buying route. Someone who clicked "Order
// your tag" on the marketing site went /shop → /owner-login?next=shop, which
// parked the intent in sessionStorage; whichever way they then signed in, they
// land here with no query string to speak of, so the parked intent is what
// carries them the last step into the shop. Read once and deleted, so a later
// visit to the dashboard opens on the vehicles tab as usual.
(function openShopFromQuery() {
  const q = new URLSearchParams(location.search);
  const afterLogin = sessionStorage.getItem("pt_after_login");
  sessionStorage.removeItem("pt_after_login");
  if (q.get("shop") === "1" || afterLogin === "shop") {
    window._replaceTagId = q.get("replace") || null;
    // Defer until the shop tab wiring is ready.
    setTimeout(() => { if (typeof switchTab === "function") switchTab("shop"); }, 0);
  }
})();

// ── Pull-to-refresh ───────────────────────────────────────────────
const PTR_THRESHOLD = 72;
let ptrStartY = 0;
let ptrTriggered = false;
const ptrEl = document.getElementById("ptrIndicator");

document.addEventListener("touchstart", e => {
  ptrStartY = e.touches[0].clientY;
  ptrTriggered = false;
}, { passive: true });

document.addEventListener("touchmove", e => {
  const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
  if (scrollTop > 0 || !ptrEl) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy > 10) {
    ptrEl.classList.add("visible");
    if (dy >= PTR_THRESHOLD) ptrTriggered = true;
  }
}, { passive: true });

document.addEventListener("touchend", () => {
  if (!ptrEl) return;
  ptrEl.classList.remove("visible");
  if (ptrTriggered) { ptrTriggered = false; load(); }
  ptrStartY = 0;
});

// ── Burger menu ────────────────────────────────────────────────────

function _vKey(tag) {
  // Same key format as vehicle-detail.js so toggle state is shared between pages
  return "pt_vd_toggles_" + (tag.plateNumber || tag.number || "demo");
}

function _sosKey(tag) {
  // Same key format as vehicle-detail.js
  return "pt_sos_" + (tag.plateNumber || tag.number || "");
}

function _loadSw(tag) {
  const def = { tagActive: true, callsActive: true, callMasking: true,
                pushNotif: true, emailAlerts: true, whatsapp: false, location: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(_vKey(tag)) || "{}") }; }
  catch { return def; }
}

// Whether THIS owner may work the call-masking switch.
//
// The same field the scanner gate reads: the switch is live exactly when a
// masked call is actually available on this tag. Read straight off the
// entitlement the dashboard API sends rather than re-derived from tag.premium
// here — the server owns the free contact, the 90-day window and the
// subscription, and a second copy of those rules on the page would eventually
// disagree with it. A tag from an older payload has no callAccess at all,
// which reads as false: when we do not know, do not offer the control.
function _maskingAvailable(tag) {
  return Boolean(tag && tag.callAccess && tag.callAccess.masking);
}

// Points a locked switch at the reason it is locked, which is the next rung of
// the ladder rather than a generic "upgrade". A spent E-Tag needs a premium
// tag; a premium tag past its window needs a subscription. Those are different
// asks and reading the wrong one would send an owner to the wrong place.
//
// Neither names a price: nothing sells the call subscription yet, so quoting
// one here would be inventing it.
function _maskingNote(tag) {
  const ca = (tag && tag.callAccess) || null;
  // A vehicle saved on this device but not yet on the server has no
  // entitlement to report. It is not a spent E-Tag and must not be told it is
  // one — there is simply nothing to mask until its tag exists.
  if (!ca) {
    return "Call masking starts once this vehicle's tag is active.";
  }
  if (ca.masking) {
    return "Hides your real number from callers. Disable to expose your actual phone number.";
  }
  if (ca.tier === "premium-lapsed") {
    return "Call masking has ended for this tag. It continues on a subscription — we'll let you know when that's available.";
  }
  return "This E-Tag's one free masked contact has been used. Get the official ParkTag sticker to keep your number hidden.";
}

// The switch is live whenever masking is: an E-Tag with its free contact still
// unspent (on by default — that contact is theirs to use), a premium tag inside
// its 90 days, or a premium tag on a subscription. Everyone else sees the true
// state (off) and cannot turn it on from here — the server would ignore them
// anyway, and a switch that flips but changes nothing is worse than one that
// plainly does not apply.
function applyMaskingSw(tag, s) {
  const el = document.getElementById("sw-masking");
  if (!el) return;

  const allowed = _maskingAvailable(tag);
  el.checked = allowed ? s.callMasking !== false : false;
  el.disabled = !allowed;

  const row = el.closest(".pt-tog");
  if (row) row.classList.toggle("pt-tog-locked", !allowed);

  const note = document.getElementById("masking-note");
  if (note) note.textContent = _maskingNote(tag);
}

function saveSw(el, key) {
  const tag = allTags[_selIdx];
  if (!tag) return;

  // Belt and braces for the one switch that is gated. The control is disabled
  // for an owner without masking, but a disabled attribute is a DOM state and
  // this re-checks the entitlement rather than trusting it.
  if (key === "callMasking" && !_maskingAvailable(tag)) {
    el.checked = false;
    _toast(_maskingNote(tag), "err");
    return;
  }

  const s = _loadSw(tag);
  s[key] = el.checked;
  localStorage.setItem(_vKey(tag), JSON.stringify(s));

  // Tag Active is backed by a real API endpoint
  if (key === "tagActive") {
    const tagId = tag.id || String(tag._id || "");
    if (!tagId) return;
    const swEl = el;
    fetch(`/api/owner/tags/${tagId}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: el.checked ? "active" : "inactive" })
    }).catch(() => {
      // Revert toggle on failure
      s[key] = !el.checked;
      localStorage.setItem(_vKey(tag), JSON.stringify(s));
      swEl.checked = !swEl.checked;
      _toast("Couldn't update tag status. Try again.", "err");
    });
  }
}
window.saveSw = saveSw;

async function saveSos() {
  const tag = allTags[_selIdx];
  const num = (document.getElementById("sos-inp")?.value || "").trim();
  if (!num) { _toast("Please enter an emergency contact number.", "err"); return; }
  if (!tag) { _toast("Select a vehicle first.", "err"); return; }

  // Persist on the tag so the scanner-side Emergency button can actually dial
  // it. localStorage alone only ever reached this one browser.
  if (tag.id) {
    try {
      const res = await fetch(`/api/owner/tags/${tag.id}/emergency-contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emergencyContact: num })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { _toast(data.error || "Could not save the emergency contact.", "err"); return; }
      tag.emergencyContact = data.emergencyContact || null;
      const el = document.getElementById("sos-inp");
      if (el && data.emergencyContact) el.value = data.emergencyContact;
      // The warning has to clear on the same save that fixes it, or the vehicle
      // keeps reading as missing until the drawer is reopened.
      setSosMissing(!data.emergencyContact);
    } catch {
      _toast("Network error — emergency contact not saved.", "err");
      return;
    }
  } else {
    // Local-only vehicle with no server tag to attach to yet.
    localStorage.setItem(_sosKey(tag), num);
  }

  _toast("Emergency contact saved.", "ok");
}
window.saveSos = saveSos;

function _fillMenu() {
  const removeBtn = document.getElementById("menuRemoveBtn");
  const tag = allTags[_selIdx];

  if (!tag) {
    const vsm = document.getElementById("menuVSummary");
    if (vsm) vsm.style.display = "none";
    if (removeBtn) removeBtn.style.display = "none";
    return;
  }

  const vsm = document.getElementById("menuVSummary");
  if (vsm) vsm.style.display = "flex";
  if (removeBtn) removeBtn.style.display = "";

  const plate = tag.plateNumber || tag.number || "—";
  const type  = tag.vehicleType || tag.type || "car";
  const label = tag.vehicleLabel || VEHICLE_LABELS[type] || "Vehicle";

  // Vehicle color for this selection
  const color = VEHICLE_COLORS[_selIdx % VEHICLE_COLORS.length];

  // ── Sticky label (Option 3) ──
  const stickyEl  = document.getElementById("stickyVehicle");
  const stickyDot = document.getElementById("stickyDot");
  const stickyPl  = document.getElementById("stickyPlate");
  const stickyTy  = document.getElementById("stickyType");
  if (stickyEl)  { stickyEl.style.borderLeftColor = color.accent; stickyEl.style.background = color.bg + "CC"; }
  if (stickyDot) stickyDot.style.background = color.accent;
  if (stickyPl)  stickyPl.textContent = plate;
  if (stickyTy)  stickyTy.textContent = label;

  // ── Profile header accent (Option 4) ──
  const ph = document.querySelector(".pt-menu-ph");
  if (ph) ph.style.borderBottom = `3px solid ${color.accent}`;

  const vpEl = document.getElementById("menuVPlate");
  const vtEl = document.getElementById("menuVType");
  const viEl = document.getElementById("menuVIcon");
  if (vpEl) vpEl.textContent = plate;
  if (vtEl) vtEl.textContent = label;
  if (viEl) {
    viEl.innerHTML = (VEHICLE_SVGS[type] || VEHICLE_SVGS.car)
      .replace(/width="28"/, 'width="22"').replace(/height="28"/, 'height="22"');
    viEl.style.background = color.bg;
    viEl.style.color      = color.accent;
  }
  if (vsm) vsm.style.borderColor = color.accent + "55";

  // Vehicle chips — each chip uses its own vehicle's color when active (Option 4)
  const chips = document.getElementById("menuChips");
  if (chips) {
    if (allTags.length > 1) {
      chips.style.display = "flex";
      chips.innerHTML = allTags.map((t, i) => {
        const c = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
        const p = t.plateNumber || t.number || "?";
        const activeStyle = i === _selIdx
          ? `background:${c.accent};border-color:${c.accent};color:#fff`
          : "";
        return `<button class="pt-mchip${i === _selIdx ? " active" : ""}" style="${activeStyle}" onclick="selectV(${i})">${esc(p)}</button>`;
      }).join("");
    } else {
      chips.style.display = "none";
    }
  }

  // Contact page link
  const link = document.getElementById("menuContactLink");
  if (link) {
    link.href = tag.scanUrl || "#";
    if (!tag.scanUrl) {
      link.onclick = e => { e.preventDefault(); _toast("Contact page not yet available for this tag.", "err"); };
    } else {
      link.onclick = null;
    }
  }

  // User info panel
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set("mi-plate",  plate);
  set("mi-type",   label);
  set("mi-name",   _owner ? (_owner.displayName || _owner.email || _owner.mobile || "—") : "—");
  set("mi-tagid",  tag.token || tag.id || "DEMO");
  const mobileEl = document.getElementById("mi-mobile");
  if (mobileEl) {
    mobileEl.textContent = _ownerMobile || "Not set";
    mobileEl.style.color = _ownerMobile ? "#03162D" : "#6B7280";
  }
  const mobileInput = document.getElementById("mi-mobile-input");
  if (mobileInput && _ownerMobile) {
    mobileInput.value = _ownerMobile.replace(/^\+91/, "");
  }
  // Phone-login users already have their number on file, so show it as detected
  // and hide the input. Only users without a mobile (Google/email login) are
  // asked to enter one.
  const mobileEdit = document.getElementById("mi-mobile-edit");
  if (mobileEdit) mobileEdit.style.display = _ownerMobile ? "none" : "flex";
  const mobileAlert = document.getElementById("mobile-missing-alert");
  if (mobileAlert) mobileAlert.style.display = _ownerMobile ? "none" : "flex";

  // Toggles — Tag Active uses real DB status; rest use localStorage
  const s = _loadSw(tag);
  const sw = (id, v) => { const el = document.getElementById(id); if (el) el.checked = v; };
  sw("sw-tag",      tag.status ? tag.status === "active" : s.tagActive);
  sw("sw-calls",    s.callsActive);
  applyMaskingSw(tag, s);
  sw("sw-push",     s.pushNotif);
  sw("sw-email",    s.emailAlerts);
  sw("sw-whatsapp", s.whatsapp);
  sw("sw-location", s.location);

  // Premium badge
  const premBadge = document.getElementById("menuPremiumBadge");
  if (premBadge) premBadge.style.display = tag.premium ? "inline-block" : "none";

  // Download menu label reflects the tag type: premium tags download the
  // official premium sticker, free tags the generated E-Tag.
  const dlLbl = document.getElementById("mi-download-lb");
  if (dlLbl) dlLbl.textContent = tag.premium ? "Download Premium Tag" : "Download E-Tag";

  // SOS number — server value wins; the localStorage key (same one
  // vehicle-detail.js uses) is only a fallback for local, unsaved vehicles.
  // Only the number the SERVER holds. The old localStorage fallback put a value
  // from this browser into a field the owner had never saved, which read as
  // "already set" for a vehicle that had no SOS at all — and it is the owner's
  // job to nominate someone else, not for us to pre-answer with whatever this
  // device happened to remember. Empty is the correct starting state.
  const sosEl = document.getElementById("sos-inp");
  if (sosEl) sosEl.value = tag.emergencyContact || "";
  // Only a number the SERVER holds counts as set. A value sitting in
  // localStorage exists on one device and cannot be dialled by the scanner
  // flow, so treating it as "done" would hide exactly the gap being flagged.
  setSosMissing(!tag.emergencyContact);
}

// Marks a vehicle with no emergency contact, both inside the panel and on the
// collapsed row, so the gap is visible without opening anything.
function setSosMissing(missing) {
  const note = document.getElementById("sos-missing");
  if (note) note.hidden = !missing;
  const row = document.querySelector('.pt-mi[data-key="sos"], .pt-mi[data-key="emergency"]');
  if (row) row.dataset.sosMissing = missing ? "1" : "0";
}

// The drawer no longer touches the bottom nav.
//
// It used to: when the Profile TAB opened the drawer, the tab had to light and
// the view behind it had to dim, or two pills lit at once. The tab now opens a
// real view instead, so switchTab owns all three pills and the drawer — reached
// from the header burger — is an overlay over whichever view is showing, the
// same as the shop's product sheet. Nothing to keep in step.

function openMenu() {
  _fillMenu();
  document.getElementById("menuBackdrop").classList.add("open");
  document.getElementById("menuDrawer").classList.add("open");
  document.body.style.overflow = "hidden";
}
window.openMenu = openMenu;

function closeMenu() {
  document.getElementById("menuBackdrop").classList.remove("open");
  document.getElementById("menuDrawer").classList.remove("open");
  document.body.style.overflow = "";
}
window.closeMenu = closeMenu;

function toggleMI(item) {
  const wasOpen = item.classList.contains("open");
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  if (!wasOpen) item.classList.add("open");
}
window.toggleMI = toggleMI;

function toggleActInfo(e) {
  e.stopPropagation();
  const tip = document.getElementById("actInfoTooltip");
  const btn = document.getElementById("actInfoBtn");
  if (!tip) return;
  const visible = tip.style.display !== "none";
  tip.style.display = visible ? "none" : "block";
  if (btn) btn.style.color = visible ? "#9CA3AF" : "#FF2700";
}
window.toggleActInfo = toggleActInfo;

function togglePhoneInfo(e) {
  e.stopPropagation();
  const tip = document.getElementById("phoneInfoTooltip");
  const btn = document.getElementById("phoneInfoBtn");
  if (!tip) return;
  const visible = tip.style.display !== "none";
  tip.style.display = visible ? "none" : "block";
  if (btn) btn.style.color = visible ? "#D97706" : "#92400E";
}
window.togglePhoneInfo = togglePhoneInfo;

document.addEventListener("click", () => {
  [
    { tip: "actInfoTooltip",   btn: "actInfoBtn",   defaultColor: "#9CA3AF" },
    { tip: "phoneInfoTooltip", btn: "phoneInfoBtn",  defaultColor: "#D97706" },
  ].forEach(({ tip: tipId, btn: btnId, defaultColor }) => {
    const tip = document.getElementById(tipId);
    const btn = document.getElementById(btnId);
    if (tip && tip.style.display !== "none") {
      tip.style.display = "none";
      if (btn) btn.style.color = defaultColor;
    }
  });
});

function goToPhoneSetup() {
  // Open the User Info accordion and focus the phone number input
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  const userInfoItem = document.querySelector("#menuDrawer .pt-mi[data-key='user-info']");
  if (userInfoItem) userInfoItem.classList.add("open");
  setTimeout(() => {
    const phoneInput = document.getElementById("mi-mobile-input");
    if (phoneInput) {
      phoneInput.scrollIntoView({ behavior: "smooth", block: "center" });
      phoneInput.focus();
    }
  }, 300);
}
window.goToPhoneSetup = goToPhoneSetup;

function selectV(idx) {
  _selIdx = idx;
  document.querySelectorAll("#menuDrawer .pt-mi.open").forEach(el => el.classList.remove("open"));
  _fillMenu();
}
window.selectV = selectV;

function goToVehicleDetail(section) {
  const tag = allTags[_selIdx];
  if (!tag) return;
  const plate = tag.plateNumber || tag.number || "";
  const type  = tag.vehicleType || tag.type || "car";
  const label = tag.vehicleLabel || VEHICLE_LABELS[type] || "Vehicle";
  const params = new URLSearchParams({
    number: plate, type, label,
    id: tag.id || String(tag._id || ""),
    token: tag.token || "",
    open: section
  }).toString();
  window.location.href = `/owner-vehicle-detail?${params}`;
}
window.goToVehicleDetail = goToVehicleDetail;

function downloadETag() {
  const tag = allTags[_selIdx];
  if (!tag) { _toast("No vehicle selected.", "err"); return; }
  const plate = tag.plateNumber || tag.number || "—";
  const etagId = tag.etagId ? String(tag.etagId).replace(/^PT-/, "") : "—";
  const status = tag.status === "inactive" ? "Inactive" : "Active";
  const qr = tag.qrDataUrl || "";

  const numEl = document.getElementById("wl-print-vehicle-num");
  const idEl  = document.getElementById("wl-print-etag-id");
  const stEl  = document.getElementById("wl-print-status");
  const qrEl  = document.getElementById("wl-print-qr-img");
  // Sticker serial, printed on the sticker face itself (not the sheet).
  const serEl = document.getElementById("wl-print-serial");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;
  if (serEl) serEl.textContent = tag.serial || "";

  setTimeout(() => window.print(), 80);
}
window.downloadETag = downloadETag;

// Download the official E-Tag sticker for a specific tag (by id), independent of
// the burger-menu selection. Reuses the shared hidden print template.
function downloadETagFor(tagId) {
  const tag = allTags.find(t => String(t.id) === String(tagId));
  if (!tag) { _toast("Vehicle not found.", "err"); return; }
  const plate  = tag.plateNumber || tag.number || "—";
  const etagId = tag.etagId ? String(tag.etagId).replace(/^PT-/, "") : "—";
  const status = tag.status === "inactive" ? "Inactive" : "Active";
  const qr     = tag.qrDataUrl || "";

  const numEl = document.getElementById("wl-print-vehicle-num");
  const idEl  = document.getElementById("wl-print-etag-id");
  const stEl  = document.getElementById("wl-print-status");
  const qrEl  = document.getElementById("wl-print-qr-img");
  // Sticker serial, printed on the sticker face itself (not the sheet).
  const serEl = document.getElementById("wl-print-serial");

  if (numEl) numEl.textContent = plate;
  if (idEl)  idEl.textContent  = etagId;
  if (stEl)  stEl.textContent  = status;
  if (qrEl)  qrEl.src          = qr;
  if (serEl) serEl.textContent = tag.serial || "";

  setTimeout(() => window.print(), 80);
}
window.downloadETagFor = downloadETagFor;

// Send the owner to the shop to buy a premium tag that REPLACES a spent
// free-trial tag (M18). The old tag id is remembered so the shop's create-order
// can pass it as replaceTagId; on a paid order the backend mints a new premium
// tag and soft-removes this old free tag, then the dashboard reloads.
function goToShopForReplace(tagId) {
  window._replaceTagId = tagId || null;
  if (typeof switchTab === "function") switchTab("shop");
}
window.goToShopForReplace = goToShopForReplace;

function goToShop() {
  closeMenu();
  window._replaceTagId = null; // generic shop visit — not a trial replacement
  if (typeof switchTab === "function") switchTab("shop");
}
window.goToShop = goToShop;

async function removeVehicle() {
  const tag = allTags[_selIdx];
  if (!tag) return;
  const plate = tag.plateNumber || tag.number || "this vehicle";
  if (!confirm(`Remove ${plate}? This cannot be undone.`)) return;
  const tagId = tag.id || String(tag._id || "");
  if (!tagId) {
    try {
      const key = userKey(_userId || "");
      const arr = JSON.parse(localStorage.getItem(key) || "[]");
      localStorage.setItem(key, JSON.stringify(
        arr.filter(v => (v.number || "").toUpperCase() !== (tag.number || "").toUpperCase())
      ));
    } catch {}
    _selIdx = 0;
    closeMenu();
    load();
    return;
  }
  try {
    const res = await fetch(`/api/owner/tags/${tagId}`, { method: "DELETE" });
    if (res.ok) {
      _selIdx = 0;
      closeMenu();
      _toast(`${plate} removed.`, "ok");
      load();
    } else {
      _toast("Couldn't remove vehicle. Try again.", "err");
    }
  } catch {
    _toast("Couldn't remove vehicle. Try again.", "err");
  }
}
window.removeVehicle = removeVehicle;

async function signOut() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  sessionStorage.clear();
  // replace(), not href: assigning pushes a new entry and leaves the dashboard
  // sitting directly behind it, so one press of Back returned to the page the
  // person had just signed out of. Replacing swaps the dashboard's own entry
  // for the sign-in page, so Back skips past it entirely.
  window.location.replace("/owner-login");
}
window.signOut = signOut;

// Deleting is irreversible, so the session cookie alone does not authorise it.
// The server wants either the account password, or — when the account has none,
// which is every OTP sign-up — a fresh code sent to the address already on the
// account. Which one applies is the server's call, and asking for the code is
// what reveals it: an account with a password is told to use it instead. That
// keeps the old behaviour of prompting for a password the owner may never have
// set out of the flow entirely.
async function deleteAccount() {
  if (!confirm("Permanently delete your account? This removes your account, all vehicles, tags, and history. This cannot be undone.")) return;

  try {
    const sent = await fetch("/api/owner/account/send-delete-code", { method: "POST" });
    const sentData = await sent.json().catch(() => ({}));

    let proof;

    if (sent.ok && sentData.ok) {
      const where = sentData.hint ? ` sent to ${sentData.hint}` : "";
      const otp = prompt(`Enter the 6-digit code${where} to confirm deleting your account:`);
      if (otp === null) return; // cancelled
      proof = { otp: String(otp).trim() };
    } else if (sentData.code === "PASSWORD_REQUIRED") {
      const password = prompt("Enter your password to confirm account deletion:");
      if (password === null) return; // cancelled
      proof = { password };
    } else {
      _toast(sentData.error || "Couldn't start account deletion. Try again.", "err");
      return;
    }

    const res = await fetch("/api/owner/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proof)
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.ok) {
      sessionStorage.clear();
      // replace(), not href: the account is gone, so leaving the dashboard one
      // Back press away restores a page built from a deleted account's data.
      window.location.replace("/owner-login");
      return;
    }
    _toast(data.error || "Couldn't delete account. Try again.", "err");
  } catch {
    _toast("Couldn't delete account. Try again.", "err");
  }
}
window.deleteAccount = deleteAccount;

var _ordersLoaded = false;
var ORDER_STATUS_LABELS = {
  processing: "Preparing to ship",
  cod_confirmed: "Confirmed · Cash on delivery",
  booking_failed: "Couldn't book courier yet — we'll retry",
  booked: "Booked with courier"
};

function humanizeOrderStatus(status) {
  if (ORDER_STATUS_LABELS[status]) return ORDER_STATUS_LABELS[status];
  // Anything else is a raw Delhivery status string (e.g. "Manifested",
  // "In Transit", "Delivered") — show it as-is, lightly formatted.
  return String(status || "Processing").replace(/_/g, " ");
}

async function loadOrdersOnce() {
  if (_ordersLoaded) return;
  _ordersLoaded = true;
  var el = document.getElementById("ordersList");
  if (!el) return;
  try {
    var res = await fetch("/api/owner/orders");
    if (!res.ok) throw new Error();
    var data = await res.json();
    var orders = (data && data.orders) || [];
    if (!orders.length) {
      el.innerHTML = '<p class="pt-snote">No orders yet.</p>';
      return;
    }
    el.innerHTML = orders.map(function (o) {
      var amount = typeof o.amount === "number" ? "₹" + (o.amount / 100).toFixed(0) : "";
      if (amount && o.paymentMethod === "cod") amount += " · COD";
      var date = o.orderedAt ? new Date(o.orderedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
      return '<div class="pt-irow" style="flex-direction:column;align-items:flex-start;gap:2px;padding:10px 0">' +
        '<div style="display:flex;justify-content:space-between;width:100%">' +
        '<span style="font-weight:700;color:#0e1220">' + esc(o.productName || "ParkTag order") + '</span>' +
        '<span style="color:#6b7280;font-size:.78rem">' + esc(amount) + '</span>' +
        '</div>' +
        '<span style="font-size:.78rem;color:#374151">' + esc(humanizeOrderStatus(o.shippingStatus)) + '</span>' +
        (o.orderNumber ? '<span style="font-size:.72rem;color:#9ca3af">Order ' + esc(o.orderNumber) + '</span>' : '') +
        // esc() is an HTML escaper and is NOT safe inside a JS string literal:
        // it turns ' into &#39;, which the HTML parser decodes back to a real
        // quote before the JS is parsed — so an apostrophe would break straight
        // out of the argument. `o.id` is a server-generated ObjectId so this
        // isn't reachable today, but rather than rely on that, require the value
        // to actually look like one before embedding it.
        (o.trackable && /^[a-f0-9]{24}$/i.test(String(o.id || ""))
          ? '<button type="button" onclick="openTracking(\'' + o.id + '\')" style="font-size:.74rem;color:#FF2700;font-weight:700;background:none;border:none;padding:0;cursor:pointer;font-family:inherit">Track order →</button>'
          : (o.waybill ? '<span style="font-size:.72rem;color:#9ca3af">Waybill: ' + esc(o.waybill) + '</span>' : '')) +
        (date ? '<span style="font-size:.7rem;color:#9ca3af">Ordered ' + esc(date) + '</span>' : '') +
        '</div>';
    }).join("");
  } catch {
    _ordersLoaded = false; // allow retry on next open
    el.innerHTML = '<p class="pt-snote">Couldn\'t load orders. Try again later.</p>';
  }
}
window.loadOrdersOnce = loadOrdersOnce;

// ── In-app Delhivery tracking timeline ───────────────────────────────
function _trackFmt(dt) {
  if (!dt) return "";
  var d = new Date(dt);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
}

function openTracking(orderId) {
  var bd = document.getElementById("ptTrackBackdrop");
  var sh = document.getElementById("ptTrackSheet");
  var body = document.getElementById("ptTrackBody");
  if (!bd || !sh || !body) return;
  body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Loading tracking…</p>';
  bd.classList.add("open");
  sh.classList.add("open");
  document.body.style.overflow = "hidden";

  fetch("/api/owner/orders/" + encodeURIComponent(orderId) + "/track")
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) { body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Couldn\'t load tracking. Try again later.</p>'; return; }
      body.innerHTML = renderTrackTimeline(d);
    })
    .catch(function () {
      body.innerHTML = '<p class="pt-snote" style="padding:24px 0;text-align:center">Couldn\'t load tracking. Try again later.</p>';
    });
}
window.openTracking = openTracking;

function closeTracking() {
  var bd = document.getElementById("ptTrackBackdrop");
  var sh = document.getElementById("ptTrackSheet");
  if (bd) bd.classList.remove("open");
  if (sh) sh.classList.remove("open");
  document.body.style.overflow = "";
}
window.closeTracking = closeTracking;

function renderTrackTimeline(d) {
  var head =
    '<div style="margin-bottom:14px">' +
      '<h3 style="margin:0 0 3px;font-size:1.05rem;font-weight:800;color:#03162D">Track order</h3>' +
      (d.orderNumber ? '<p style="margin:0;font-size:.8rem;color:#6b7280">' + esc(d.orderNumber) + (d.productName ? ' · ' + esc(d.productName) : '') + '</p>' : '') +
    '</div>';

  var current =
    '<div style="background:#F9FAFB;border:1px solid #EEF0F3;border-radius:12px;padding:12px 14px;margin-bottom:16px">' +
      '<div style="font-size:.68rem;color:#9ca3af;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Current status</div>' +
      '<div style="font-size:.95rem;font-weight:800;color:#03162D;margin-top:2px">' + esc(humanizeOrderStatus(d.status)) + '</div>' +
      (d.statusDateTime ? '<div style="font-size:.74rem;color:#6b7280;margin-top:1px">' + esc(_trackFmt(d.statusDateTime)) + '</div>' : '') +
    '</div>';

  var scans = Array.isArray(d.scans) ? d.scans : [];
  var timeline;
  if (!scans.length) {
    timeline = '<p class="pt-snote" style="text-align:center;padding:8px 0">No tracking updates yet. We\'ll show each step here once the courier scans your parcel.</p>';
  } else {
    timeline = '<div style="position:relative;padding-left:22px">' +
      '<div style="position:absolute;left:5px;top:6px;bottom:10px;width:2px;background:#E5E7EB"></div>' +
      scans.map(function (s, i) {
        var isLatest = i === 0;
        var dot = isLatest ? "#FF2700" : "#C9CDD3";
        return '<div style="position:relative;padding:0 0 16px 0">' +
          '<span style="position:absolute;left:-22px;top:2px;width:11px;height:11px;border-radius:50%;background:' + dot + ';box-shadow:0 0 0 3px #fff"></span>' +
          '<div style="font-size:.86rem;font-weight:' + (isLatest ? "800" : "600") + ';color:#03162D">' + esc(humanizeOrderStatus(s.status)) + '</div>' +
          (s.location ? '<div style="font-size:.76rem;color:#6b7280">' + esc(s.location) + '</div>' : '') +
          (s.dateTime ? '<div style="font-size:.72rem;color:#9ca3af">' + esc(_trackFmt(s.dateTime)) + '</div>' : '') +
        '</div>';
      }).join("") +
      '</div>';
  }

  var footer = d.trackingUrl
    ? '<a href="' + esc(d.trackingUrl) + '" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:.76rem;color:#6b7280;text-decoration:underline">Open on Delhivery ↗</a>'
    : '';

  return head + current + timeline + footer;
}

function _toast(msg, tone) {
  const existing = document.getElementById("pt-toast");
  if (existing) existing.remove();
  const t = document.createElement("div");
  t.id = "pt-toast";
  t.textContent = msg;
  Object.assign(t.style, {
    position: "fixed", bottom: "90px", left: "50%", transform: "translateX(-50%)",
    background: tone === "ok" ? "#FF2700" : "#EF4444",
    color: "#fff", padding: "11px 20px", borderRadius: "11px",
    fontWeight: "700", fontSize: ".85rem", zIndex: "9999",
    boxShadow: "0 4px 16px rgba(0,0,0,.18)", maxWidth: "88vw",
    textAlign: "center", whiteSpace: "nowrap"
  });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
