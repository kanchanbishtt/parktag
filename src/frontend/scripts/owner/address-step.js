/*
 * Shared delivery-address step for physical-sticker checkout.
 *
 * Exposes window.ptCollectAddress() -> Promise<boolean>. Every "buy a physical
 * sticker" flow (per-tag premium on the dashboard + vehicle detail, and the Shop
 * tab) awaits this before opening Razorpay. Plain global script on purpose so both
 * the inline shop handler and the ES-module dashboard can call it.
 *
 * Two states, so returning buyers don't re-type an address they already gave:
 *   • No saved address  -> show the full form, save on submit.
 *   • Saved address      -> show a compact "Deliver here" confirmation. The user
 *                           either confirms (proceeds straight to pay) or taps
 *                           "Edit" — for when they've moved — to change it.
 * The address is stored once per account and reused; on a change it overwrites the
 * saved one, but each order keeps its own snapshot, so delivery history is intact.
 */
(function () {
  "use strict";
  if (window.ptCollectAddress) return; // guard against double-inclusion

  var els = null; // built lazily on first open
  var resolver = null; // resolve fn of the in-flight promise
  var savedAddress = null; // last address fetched from the server this open
  var profileName = "";    // owner's profile name, used only to prefill a blank

  // Inline icons (no network dependency — works offline / on flaky mobile data).
  var IC = {
    pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.6 3.5 8.9 3.9l1 3.4-1.7 1.4a12 12 0 0 0 5.1 5.1l1.4-1.7 3.4 1 .4 2.3a1.6 1.6 0 0 1-1.6 1.9A13.4 13.4 0 0 1 4.7 5.1 1.6 1.6 0 0 1 6.6 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l.9-3.6a2 2 0 0 1 .5-.9l10-10a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-10 10a2 2 0 0 1-.9.5L4 20Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.7"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  var FIELDS = [
    { key: "fullName", label: "Full name", type: "text", ph: "Recipient name", auto: "name" },
    { key: "phone", label: "Mobile number", type: "tel", ph: "10-digit mobile", auto: "tel", maxlength: 10, inputmode: "numeric" },
    { key: "line1", label: "House / Flat, Street", type: "text", ph: "e.g. 12B, MG Road", auto: "address-line1" },
    { key: "line2", label: "Area / Locality (optional)", type: "text", ph: "Colony, sector", auto: "address-line2", optional: true },
    { key: "landmark", label: "Landmark (optional)", type: "text", ph: "Near…", optional: true },
    { key: "city", label: "City", type: "text", ph: "City", auto: "address-level2" },
    { key: "state", label: "State", type: "text", ph: "State", auto: "address-level1" },
    { key: "pincode", label: "PIN code", type: "text", ph: "6-digit PIN", maxlength: 6, inputmode: "numeric" }
  ];

  function injectStyles() {
    if (document.getElementById("pt-addr-styles")) return;
    var css = [
      // Design tokens, scoped to the sheet.
      "#pt-addr-ov{--r:#FF2700;--r-press:#d81f00;--ink:#0e1220;--muted:#6b7280;--line:#ececf0;--card:#fafafb;--tint:rgba(255,39,0,.08);",
      "position:fixed;inset:0;z-index:1200;display:none;align-items:flex-end;justify-content:center;",
      "background:rgba(14,18,32,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .2s ease;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}",
      "#pt-addr-ov.pt-open{display:flex;opacity:1;}",

      // Sheet
      "#pt-addr-sheet{background:#fff;width:100%;max-width:460px;max-height:94vh;overflow-y:auto;-webkit-overflow-scrolling:touch;",
      "border-radius:28px 28px 0 0;padding:10px 22px calc(22px + env(safe-area-inset-bottom));",
      "box-shadow:0 -18px 50px -12px rgba(14,18,32,.35);opacity:0;transform-origin:bottom center;}",
      // Gentle pop-in — a touch of overshoot, not a full bounce.
      "#pt-addr-sheet.pt-in{animation:pt-pop .26s cubic-bezier(.22,1.15,.35,1) forwards;}",
      "@keyframes pt-pop{0%{opacity:0;transform:scale(.92) translateY(10px);}55%{opacity:1;transform:scale(1.018) translateY(0);}100%{opacity:1;transform:scale(1);}}",
      "@media(min-width:520px){#pt-addr-ov{align-items:center;padding:16px;}#pt-addr-sheet{border-radius:26px;box-shadow:0 30px 70px -20px rgba(14,18,32,.5);transform-origin:center;}}",

      // Grab handle
      "#pt-addr-grip{width:38px;height:4px;border-radius:99px;background:#e2e2ea;margin:0 auto 16px;}",

      // Header
      ".pt-addr-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:.66rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--r);margin-bottom:9px;}",
      ".pt-addr-eyebrow svg{width:13px;height:13px;}",
      "#pt-addr-sheet h3{margin:0 0 4px;font-size:1.32rem;font-weight:800;letter-spacing:-.02em;color:var(--ink);}",
      "#pt-addr-sheet .pt-addr-sub{margin:0 0 18px;font-size:.86rem;line-height:1.4;color:var(--muted);}",
      ".pt-hide{display:none!important;}",

      // Confirm card
      "#pt-addr-card{position:relative;display:flex;gap:13px;border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:18px;background:var(--card);}",
      "#pt-addr-card .pt-pin{flex:0 0 auto;width:40px;height:40px;border-radius:12px;background:var(--tint);color:var(--r);display:flex;align-items:center;justify-content:center;}",
      "#pt-addr-card .pt-pin svg{width:22px;height:22px;}",
      "#pt-addr-card .pt-body{flex:1;min-width:0;}",
      "#pt-addr-card .pt-name{font-weight:800;color:var(--ink);font-size:1rem;letter-spacing:-.01em;padding-right:66px;}",
      "#pt-addr-card .pt-street,#pt-addr-card .pt-region{color:#4b5563;font-size:.88rem;line-height:1.5;margin-top:2px;word-break:break-word;}",
      "#pt-addr-card .pt-ph{display:flex;align-items:center;gap:6px;color:var(--muted);font-size:.82rem;margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);}",
      "#pt-addr-card .pt-ph svg{width:14px;height:14px;}",
      "#pt-addr-chip{position:absolute;top:14px;right:14px;display:inline-flex;align-items:center;gap:4px;background:var(--tint);color:var(--r);font-size:.64rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase;padding:4px 9px;border-radius:99px;}",
      "#pt-addr-chip svg{width:11px;height:11px;}",

      // Form fields
      ".pt-addr-f{margin-bottom:13px;}",
      ".pt-addr-f.pt-half{display:inline-block;width:calc(50% - 5px);vertical-align:top;}",
      ".pt-addr-f.pt-half+.pt-half{margin-left:8px;}",
      ".pt-addr-f label{display:block;font-size:.72rem;font-weight:700;letter-spacing:.01em;color:#374151;margin-bottom:5px;}",
      ".pt-req{color:var(--r);margin-left:3px;font-weight:800;}",
      ".pt-addr-f input{width:100%;box-sizing:border-box;padding:12px 13px;border:1.5px solid #e6e6ec;border-radius:13px;font-size:.94rem;color:var(--ink);background:#fff;outline:none;transition:border-color .15s,box-shadow .15s;}",
      ".pt-addr-f input::placeholder{color:#a8adb8;}",
      ".pt-addr-f input:focus{border-color:var(--r);box-shadow:0 0 0 3.5px var(--tint);}",
      "#pt-addr-err{display:none;background:#fdecec;color:#c0271b;font-size:.8rem;font-weight:600;padding:10px 13px;border-radius:11px;margin-bottom:13px;}",
      "#pt-addr-err.pt-show{display:block;}",

      // Buttons
      ".pt-addr-primary{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;padding:16px;border:none;border-radius:16px;",
      "background:linear-gradient(180deg,#ff3a17,var(--r));color:#fff;font-size:1rem;font-weight:800;letter-spacing:.01em;cursor:pointer;",
      "box-shadow:0 10px 22px -8px rgba(255,39,0,.6);transition:transform .12s ease,box-shadow .2s ease,background .2s ease;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-primary svg{width:19px;height:19px;}",
      ".pt-addr-primary:hover{box-shadow:0 12px 26px -8px rgba(255,39,0,.72);}",
      ".pt-addr-primary:active{transform:scale(.975);}",
      ".pt-addr-primary:disabled{opacity:.65;cursor:default;box-shadow:none;transform:none;}",
      ".pt-addr-secondary{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;margin-top:10px;",
      "border:1.5px solid #e6e6ec;border-radius:15px;background:#fff;color:#374151;font-size:.9rem;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-secondary svg{width:16px;height:16px;color:var(--muted);}",
      ".pt-addr-secondary:hover{background:#f7f7f9;border-color:#dcdce4;}",
      ".pt-addr-secondary:active{background:#f0f0f3;}",
      ".pt-addr-link{width:100%;padding:12px;margin-top:6px;border:none;background:none;color:var(--muted);font-size:.85rem;font-weight:600;cursor:pointer;border-radius:12px;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-link:hover{color:#374151;}",

      // Secure footer
      "#pt-addr-secure{display:flex;align-items:center;justify-content:center;gap:6px;margin:16px 0 2px;color:#9aa0ac;font-size:.72rem;font-weight:600;}",
      "#pt-addr-secure svg{width:13px;height:13px;}",
      "#pt-addr-note{margin:9px 0 0;font-size:.72rem;color:#a3a8b3;text-align:center;}",

      // Reduced motion
      "@media(prefers-reduced-motion:reduce){#pt-addr-ov,.pt-addr-primary{transition:none;}#pt-addr-sheet.pt-in{animation:none;opacity:1;}}"
    ].join("");
    var s = document.createElement("style");
    s.id = "pt-addr-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    injectStyles();
    var ov = document.createElement("div");
    ov.id = "pt-addr-ov";

    var rows = FIELDS.map(function (f) {
      var half = f.key === "city" || f.key === "state" || f.key === "pincode";
      var attrs =
        'type="' + f.type + '" id="pt-addr-' + f.key + '" placeholder="' + f.ph + '"' +
        (f.maxlength ? ' maxlength="' + f.maxlength + '"' : "") +
        (f.inputmode ? ' inputmode="' + f.inputmode + '"' : "") +
        (f.auto ? ' autocomplete="' + f.auto + '"' : "");
      // Required fields carry a *. Marking only the mobile would have implied
      // the rest were optional, so the star comes off `optional` — the same flag
      // the labels already use to write "(optional)" — and the two can't drift.
      var star = f.optional ? "" : '<span class="pt-req" aria-hidden="true">*</span>';
      var req = f.optional ? "" : " required aria-required=\"true\"";
      return '<div class="pt-addr-f' + (half ? " pt-half" : "") + '"><label for="pt-addr-' + f.key + '">' +
        f.label + star + "</label><input " + attrs + req + "></div>";
    }).join("");

    var secure =
      '<div id="pt-addr-secure">' + IC.lock + "Secured by Razorpay · UPI · Cards · Net Banking</div>";

    ov.innerHTML =
      '<div id="pt-addr-sheet" role="dialog" aria-modal="true" aria-label="Delivery address">' +
      '<div id="pt-addr-grip"></div>' +
      '<span class="pt-addr-eyebrow" id="pt-addr-eyebrow">' + IC.pin + '<span>Delivery</span></span>' +
      '<h3 id="pt-addr-title">Delivery address</h3>' +
      '<p class="pt-addr-sub" id="pt-addr-sub">Where should we ship your official ParkTag sticker?</p>' +

      // ── Confirm view (returning buyer) ──
      '<div id="pt-addr-confirm" class="pt-hide">' +
      '<div id="pt-addr-card">' +
      '<div id="pt-addr-chip">' + IC.check + "Saved</div>" +
      '<div class="pt-pin">' + IC.pin + "</div>" +
      '<div class="pt-body">' +
      '<div class="pt-name"></div>' +
      '<div class="pt-street"></div>' +
      '<div class="pt-region"></div>' +
      '<div class="pt-ph"></div>' +
      "</div></div>" +
      '<button id="pt-addr-deliver" class="pt-addr-primary" type="button">' + IC.lock + "Deliver here &amp; pay</button>" +
      '<button id="pt-addr-edit" class="pt-addr-secondary" type="button">' + IC.edit + "Address changed? Edit</button>" +
      '<button id="pt-addr-cancel2" class="pt-addr-link" type="button">Cancel</button>' +
      secure +
      "</div>" +

      // ── Form view (first time / editing) ──
      '<div id="pt-addr-form" class="pt-hide">' +
      '<div id="pt-addr-err"></div>' +
      rows +
      '<button id="pt-addr-save" class="pt-addr-primary" type="button">' + IC.lock + "Save &amp; continue to pay</button>" +
      '<button id="pt-addr-cancel" class="pt-addr-link" type="button">Cancel</button>' +
      '<p id="pt-addr-note">Saved to your profile — you won\'t need to enter it again.</p>' +
      secure +
      "</div>" +
      "</div>";

    document.body.appendChild(ov);

    els = {
      ov: ov,
      sheet: ov.querySelector("#pt-addr-sheet"),
      title: ov.querySelector("#pt-addr-title"),
      sub: ov.querySelector("#pt-addr-sub"),
      confirm: ov.querySelector("#pt-addr-confirm"),
      form: ov.querySelector("#pt-addr-form"),
      cardName: ov.querySelector("#pt-addr-card .pt-name"),
      cardStreet: ov.querySelector("#pt-addr-card .pt-street"),
      cardRegion: ov.querySelector("#pt-addr-card .pt-region"),
      cardPhone: ov.querySelector("#pt-addr-card .pt-ph"),
      err: ov.querySelector("#pt-addr-err"),
      deliver: ov.querySelector("#pt-addr-deliver"),
      edit: ov.querySelector("#pt-addr-edit"),
      save: ov.querySelector("#pt-addr-save"),
      inputs: {}
    };
    FIELDS.forEach(function (f) { els.inputs[f.key] = ov.querySelector("#pt-addr-" + f.key); });

    // Digits-only guard for phone + pincode.
    ["phone", "pincode"].forEach(function (k) {
      els.inputs[k].addEventListener("input", function () {
        this.value = this.value.replace(/[^0-9]/g, "");
      });
    });

    // Confirm view: proceed with the already-saved address (no re-save needed).
    els.deliver.addEventListener("click", function () { close(true); });
    // Confirm view: they've moved — open the prefilled form to change it.
    els.edit.addEventListener("click", function () { showForm(savedAddress); });

    els.save.addEventListener("click", onSave);
    ov.querySelector("#pt-addr-cancel").addEventListener("click", function () { close(false); });
    ov.querySelector("#pt-addr-cancel2").addEventListener("click", function () { close(false); });
    ov.addEventListener("click", function (e) { if (e.target === ov) close(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("pt-open")) close(false);
    });
  }

  function showErr(msg) {
    els.err.textContent = msg;
    els.err.classList.add("pt-show");
  }
  function clearErr() {
    els.err.textContent = "";
    els.err.classList.remove("pt-show");
  }

  function validate(v) {
    if (!v.fullName || v.fullName.length < 2) return "Please enter the recipient's full name.";
    if (!/^[6-9][0-9]{9}$/.test(v.phone)) return "Enter a valid 10-digit mobile number.";
    if (!v.line1 || v.line1.length < 4) return "Enter your house / flat and street.";
    if (!v.city || v.city.length < 2) return "Please enter your city.";
    if (!v.state || v.state.length < 2) return "Please enter your state.";
    if (!/^[1-9][0-9]{5}$/.test(v.pincode)) return "Enter a valid 6-digit PIN code.";
    return null;
  }

  function readForm() {
    var v = {};
    FIELDS.forEach(function (f) { v[f.key] = (els.inputs[f.key].value || "").trim(); });
    return v;
  }

  // Render the saved address into the confirm card and show the confirm view.
  function showConfirm(addr) {
    var street = [addr.line1, addr.line2, addr.landmark].filter(Boolean).join(", ");
    var region = [addr.city, addr.state].filter(Boolean).join(", ");
    if (addr.pincode) region = (region ? region + " — " : "") + addr.pincode;
    els.cardName.textContent = addr.fullName || "";
    els.cardStreet.textContent = street;
    els.cardRegion.textContent = region;
    // IC.phone is a static developer-defined icon (safe as HTML); addr.phone is
    // user input, so set it via textContent rather than concatenating into innerHTML.
    if (addr.phone) {
      els.cardPhone.innerHTML = IC.phone + "<span></span>";
      els.cardPhone.querySelector("span").textContent = addr.phone;
    } else {
      els.cardPhone.textContent = "";
    }
    els.title.textContent = "Confirm delivery address";
    els.sub.textContent = "We'll ship your ParkTag sticker here.";
    els.form.classList.add("pt-hide");
    els.confirm.classList.remove("pt-hide");
  }

  // Show the editable form, optionally prefilled with an existing address.
  function showForm(prefill) {
    clearErr();
    FIELDS.forEach(function (f) {
      els.inputs[f.key].value = prefill && prefill[f.key] != null ? prefill[f.key] : "";
    });
    // First-time buyers have no address to prefill from, but many do have a
    // name on their profile by now. Filling it saves them retyping what we
    // already know, and it stays editable — plenty of people ship to someone
    // else. Only ever fills a blank; a saved address always wins.
    if (!els.inputs.fullName.value && profileName) {
      els.inputs.fullName.value = profileName;
    }
    els.title.textContent = prefill ? "Edit delivery address" : "Delivery address";
    els.sub.textContent = prefill
      ? "Update where we should ship your sticker."
      : "Where should we ship your official ParkTag sticker?";
    els.confirm.classList.add("pt-hide");
    els.form.classList.remove("pt-hide");
  }

  async function onSave() {
    clearErr();
    var v = readForm();
    var problem = validate(v);
    if (problem) { showErr(problem); return; }

    els.save.disabled = true;
    var label = els.save.innerHTML;
    els.save.textContent = "Saving…";
    try {
      var res = await fetch("/api/owner/address", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(v)
      });
      // Not signed in as a vehicle owner (no owner session, or a session for a
      // different role such as admin). The raw API error here is "Forbidden" /
      // "Authentication required", which is confusing on a checkout form — show
      // an actionable message instead.
      if (res.status === 401 || res.status === 403) {
        throw new Error("Please sign in as a vehicle owner to save your delivery address.");
      }
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not save address.");
      close(true);
    } catch (e) {
      showErr(e.message || "Could not save address. Please try again.");
    } finally {
      els.save.disabled = false;
      els.save.innerHTML = label;
    }
  }

  function close(saved) {
    if (els) els.ov.classList.remove("pt-open");
    var r = resolver;
    resolver = null;
    if (r) r(!!saved);
  }

  // Fetch the saved address (if any) to decide which view to show.
  async function fetchSaved() {
    try {
      var res = await fetch("/api/owner/address");
      if (!res.ok) return null;
      var data = await res.json();
      return data && data.address ? data.address : null;
    } catch (_) {
      return null; // network hiccup — fall back to the form
    }
  }

  // The name already on the profile, used only to prefill a blank recipient
  // field. Best-effort: if this fails the form simply opens empty, exactly as
  // it did before, so the address flow never depends on it.
  async function fetchProfileName() {
    try {
      var res = await fetch("/api/owner/dashboard");
      if (!res.ok) return "";
      var data = await res.json();
      return (data && data.owner && data.owner.displayName) || "";
    } catch (_) {
      return "";
    }
  }

  // Restart the pop-in animation on the sheet (re-add the class after a reflow).
  function popIn() {
    els.sheet.classList.remove("pt-in");
    void els.sheet.offsetWidth; // force reflow so the animation replays
    els.sheet.classList.add("pt-in");
  }

  // Public API: resolves true once the address is confirmed/saved, false if dismissed.
  window.ptCollectAddress = function () {
    if (!els) build();
    return new Promise(function (resolve) {
      // If a sheet is somehow already open, cancel the previous waiter.
      if (resolver) resolver(false);
      resolver = resolve;
      // Fetch first, then reveal the populated sheet with a pop — so it never
      // pops in empty and then fills. The fetch is quick; the backdrop fades
      // meanwhile via the overlay's own transition.
      els.confirm.classList.add("pt-hide");
      els.form.classList.add("pt-hide");
      els.sheet.classList.remove("pt-in");
      els.ov.classList.add("pt-open");
      // Both requests go out together: the profile name is only needed for the
      // blank-form case, and waiting for it in series would delay the sheet for
      // everyone who already has an address saved.
      Promise.all([fetchSaved(), fetchProfileName()]).then(function (results) {
        var addr = results[0];
        profileName = results[1] || "";
        savedAddress = addr;
        if (addr) showConfirm(addr);
        else showForm(null);
        popIn();
      });
    });
  };
})();
