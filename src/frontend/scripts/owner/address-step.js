/*
 * Shared delivery-address step for physical-sticker checkout.
 *
 * Exposes window.ptCollectAddress(). Every "buy a physical sticker" flow awaits
 * this before opening Razorpay: per-tag premium on the dashboard and vehicle
 * detail, the Shop tab, and the public storefront at /get. Plain global script
 * on purpose, so the inline shop handler, the ES-module dashboard and the
 * storefront's module can all call the one sheet.
 *
 * Resolves false if dismissed. Otherwise `true` for a signed-in owner, whose
 * address is saved to their profile — or, called as ptCollectAddress({ guest:
 * true }), the address object itself, because /get sells to someone with no
 * profile to save it to and sends the address with the order instead. A guest
 * who picks Cash on Delivery proves the mobile with a WhatsApp code first and
 * gets { ...address, paymentMethod: "cod", codToken } for create-order.
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
  // Guard against double-inclusion. checkout-loader.js parks a stub under this
  // name (flagged .lazy) until the real file arrives, which is this one.
  if (window.ptCollectAddress && !window.ptCollectAddress.lazy) return;

  var els = null; // built lazily on first open
  var resolver = null; // resolve fn of the in-flight promise
  var savedAddress = null; // last address fetched from the server this open
  var profileName = "";    // owner's profile name, used only to prefill a blank
  var orderSummary = null; // optional pack and price shown before collecting an address

  // Guest mode: the same sheet, on a page where there is no account.
  //
  // /get sells to someone who has never signed in, and the address it collects
  // is sent with the order rather than saved to a profile that does not exist.
  // So in this mode nothing is fetched — there is no saved address to offer and
  // no profile name to prefill — and nothing is POSTed; the address is handed
  // back to the caller instead.
  //
  // A mode on this module rather than a second address sheet on the storefront.
  // There was briefly a second one, and it was already drifting: different
  // fields, different validation, none of the "deliver here again" behaviour.
  // One address step, two callers, is the whole reason this file is a shared
  // global in the first place.
  var guestMode = false;

  // Guest Cash on Delivery. When the caller passes orderSummary.cod, the
  // summary offers "Pay online" vs "Cash on delivery" and a guest resolves
  // with { ...address, paymentMethod }. Online is the default on every open.
  var payChoice = "online";
  var trackedFields = {}; // checkout_field sent this open, by field key
  var payPrices = null; // { online, cod, mrp } for this open, or null: no COD offered
  var priced = null; // { name, amount, mrp, fee, addOn } for this open, or null: no order shown
  // The optional extra a caller can offer inside the sheet (the clear dashboard
  // plate on /get): { id, name, description, amountPaise, image, checked,
  // onChange }. addOnOn is whether it is ticked now. The caller's summary
  // arrives WITHOUT it; currentSummary() adds it, so ticking and unticking just
  // re-run the same pricing with one more line.
  var addOnOffer = null;
  var addOnOn = false;

  // Guest COD phone check. The server will not place a COD order until the
  // delivery mobile has passed a code, so the sheet sends one and verifies it
  // before resolving. captchaFn is the caller's reCAPTCHA getter, or null.
  var captchaFn = null;
  var codAddress = null; // the validated address waiting on its code
  var resendTimer = null;
  var RESEND_SECONDS = 30; // above the server's 20s double-submit window

  // ── Surviving a reload ────────────────────────────────────────────────────
  //
  // A reload used to throw away every line typed into this sheet, on every page
  // that opens it. /get kept its own copy by reading this sheet's elements from
  // outside; /shop, /direct and the dashboard kept nothing. So the sheet now
  // keeps its own draft: the fields, the Cash on Delivery choice and an
  // UNTICKED WhatsApp box. Whichever page opens it next gets them back.
  //
  // The page decides whether to REOPEN the sheet after a reload, because only
  // the page knows which pack was being bought. This file only makes sure that
  // when it does, nothing has to be typed twice.
  //
  // sessionStorage, not localStorage: an address is personal, so it lasts for
  // this tab and is gone when the tab closes. The mode is stored with it, so a
  // guest's draft is never poured into a signed-in owner's profile form.
  var DRAFT_KEY = "pt_addr_draft";

  function draftRead() {
    try {
      var d = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      var mode = guestMode ? "guest" : "owner";
      return d && typeof d === "object" && d.mode === mode && d.fields && typeof d.fields === "object" ? d : null;
    } catch (_) {
      return null; // private mode, storage disabled, corrupt value: never fatal
    }
  }

  // Called on every keystroke and choice, and after the sheet fills a box
  // itself (the pincode lookup, a picked suggestion), which fires no event.
  function draftKeep() {
    // Only while the sheet is up. A pincode lookup that answers after the sheet
    // was dismissed must not write a draft back that the dismissal just cleared.
    if (!els || !resolver) return;
    var fields = {};
    FIELDS.forEach(function (f) {
      var value = els.inputs[f.key].value;
      if (value) fields[f.key] = value;
    });
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        mode: guestMode ? "guest" : "owner",
        fields: fields,
        pay: payChoice,
        optIn: !!(els.optIn && els.optIn.checked)
      }));
    } catch (_) { /* ignore */ }
  }

  // Once the order exists (or the address is saved to the profile) there is
  // nothing left to bring back, and a finished purchase must not prefill the
  // next one. Exposed as ptCollectAddress.clearDraft for the pages to call.
  function draftClear() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
  }

  // ── Getting the slow things ready before the tap ──────────────────────────
  //
  // When a guest taps "Continue to pay" the server has to ask the courier
  // whether the pincode is served and open a connection to Razorpay, and the
  // buyer used to wait for both. Neither needs the tap: the pincode is known
  // as soon as it is typed, and the payment is a few seconds away once the
  // form is complete. So the server is told at those two moments
  // (POST /api/shop/guest/warm) and does that work while the buyer is still
  // reading the form.
  //
  // Only the pincode is sent. Not the name, the phone or the address: nothing
  // personal leaves this sheet before the buyer presses the button. Nothing
  // comes back and nothing here depends on it, so a call that fails, or is
  // blocked, costs the buyer only the speed-up.
  var WARM_EVERY_MS = 20 * 1000;
  var warmedPin = "";
  var warmedAt = 0;

  function warmCheckout() {
    // Guests only: the signed-in checkout goes through a different route.
    if (!guestMode || !els || !resolver) return;
    var pin = els.inputs.pincode.value;
    if (!/^[1-9][0-9]{5}$/.test(pin)) return;
    var now = Date.now();
    if (pin === warmedPin && now - warmedAt < WARM_EVERY_MS) return;
    warmedPin = pin;
    warmedAt = now;
    try {
      fetch("/api/shop/guest/warm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pincode: pin })
      }).catch(function () { /* a hint, never an error */ });
    } catch (_) { /* a hint, never an error */ }
  }

  // The form as it stands would be accepted: the tap is close.
  function warmIfComplete() {
    if (!guestMode || !els || !resolver) return;
    if (validate(readForm()) === null) {
      warmCheckout();
      if (payChoice === "cod") primeCaptcha();
    }
  }

  // The sheet is an overlay on the page, not a page of its own, so the phone's
  // back button used to leave the storefront altogether — and in an in-app
  // browser (Instagram, the Google app) that meant a blank tab. Opening the
  // sheet now adds one history entry; back pops it and dismisses the sheet,
  // and every other way of closing it takes the entry away again.
  var historyEntry = false;

  // Inline icons (no network dependency — works offline / on flaky mobile data).
  var IC = {
    pin: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 1 0-14 0c0 5.314 7 11 7 11Z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.6" stroke="currentColor" stroke-width="1.7"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.6 3.5 8.9 3.9l1 3.4-1.7 1.4a12 12 0 0 0 5.1 5.1l1.4-1.7 3.4 1 .4 2.3a1.6 1.6 0 0 1-1.6 1.9A13.4 13.4 0 0 1 4.7 5.1 1.6 1.6 0 0 1 6.6 3.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.5 5.5 4 4M4 20l.9-3.6a2 2 0 0 1 .5-.9l10-10a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8l-10 10a2 2 0 0 1-.9.5L4 20Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke="currentColor" stroke-width="1.7"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2a1.5 1.5 0 0 1 1.06.44l7.3 7.3a1.5 1.5 0 0 1 0 2.12l-6.7 6.7a1.5 1.5 0 0 1-2.12 0l-7.3-7.3a1.5 1.5 0 0 1-.44-1.06Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.3" cy="8.3" r="1.4" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  // States and union territories as the courier label needs them written. A
  // dropdown, not a text box: "UP", "U.P." and "uttar pradesh" all reached the
  // shipping sheet before, and a state that does not parse is a parcel that
  // sits in a sorting hub.
  var STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
    "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
    "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
    "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
    "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
  ];

  var FIELDS = [
    { key: "fullName", label: "Full name", type: "text", ph: "Recipient name", auto: "name" },
    { key: "phone", label: "Mobile number", type: "tel", ph: "10-digit mobile", auto: "tel", maxlength: 10, inputmode: "numeric" },
    // PIN before the street: it fills City and State (see lookupPin), so most
    // buyers type five fields, not eight. Landmark lives in the area line.
    // Not "PIN": next to a payment step that reads as a card or UPI PIN, and one
    // buyer typed exactly that (PT-260927-00037).
    { key: "pincode", label: "Pincode (postal code)", type: "text", ph: "e.g. 110052", maxlength: 6, inputmode: "numeric", auto: "postal-code" },
    { key: "line1", label: "House / Flat, Street", type: "text", ph: "e.g. 12B, MG Road", auto: "address-line1" },
    { key: "line2", label: "Area, Landmark (optional)", type: "text", ph: "Sector, colony, near…", auto: "address-line2", optional: true },
    { key: "city", label: "City", type: "text", ph: "City", auto: "address-level2" },
    { key: "state", label: "State", type: "select", ph: "Select state", auto: "address-level1", options: STATES }
  ];

  function injectStyles() {
    if (document.getElementById("pt-addr-styles")) return;
    var css = [
      // Design tokens, scoped to the sheet. --ease is the one curve everything
      // here moves on: quick off the mark, long settle, no overshoot.
      // --ground is #F6F8FB, the same value get.css calls --gt-ground and paints
      // the storefront with, so the sheet sits on the page's own ground rather
      // than a warmer white. --navy is the brand ink the CTAs are cut from.
      // --line/--card were faintly warm (#ececf0 / #fafafb, both a touch violet);
      // they are cool now, and the card is plain white so it lifts off --ground.
      // Tokens are the Stitch "ParkTag Direct Trust" system: navy ink, the alert
      // red for the one conversion control, slate microcopy, slate-50 fields.
      "#pt-addr-ov{--r:#FF3B30;--r-press:#E5322A;--navy:#0B132B;--navy-2:#131A33;--navy-sh:rgba(11,19,43,.42);",
      "--ink:#0B132B;--muted:#64748B;--ground:#F8FAFC;--line:#E2E8F0;--card:#fff;--field:#F1F5F9;--tint:rgba(255,59,48,.08);",
      "--ease:cubic-bezier(.22,1,.36,1);",
      "position:fixed;inset:0;z-index:1200;display:none;align-items:flex-end;justify-content:center;",
      "background:rgba(14,18,32,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}",

      // The backdrop is animated, not transitioned, and that is the whole reason
      // it used to snap on: a transition cannot run on the same frame an element
      // goes from display:none to display:flex, so the fade that was written
      // here never actually played. An animation does run on that frame.
      "#pt-addr-ov.pt-open{display:flex;animation:pt-bd-in .28s ease forwards;}",
      // pointer-events off on the way out: the sheet resolves and the caller
      // opens Razorpay at once, so this must not sit over it while it fades.
      "#pt-addr-ov.pt-closing{pointer-events:none;animation:pt-bd-out .18s ease forwards;}",
      "@keyframes pt-bd-in{from{opacity:0}to{opacity:1}}",
      "@keyframes pt-bd-out{from{opacity:1}to{opacity:0}}",

      // Sheet
      "#pt-addr-sheet{background:var(--ground);width:100%;max-width:460px;max-height:94vh;overflow-y:auto;-webkit-overflow-scrolling:touch;",
      "border-radius:28px 28px 0 0;padding:10px 22px calc(22px + env(safe-area-inset-bottom));",
      "box-shadow:0 -18px 50px -12px rgba(14,18,32,.35);opacity:0;transform:translate3d(0,100%,0);",
      "transform-origin:bottom center;will-change:transform,opacity;}",
      // The sheet still scrolls (wheel, touch, keys); only the native bar is
      // hidden. Its grey track sat against the rounded card and the grip is the
      // affordance here, as it already is for the gallery on /get.
      "#pt-addr-sheet{scrollbar-width:none;-ms-overflow-style:none;}",
      "#pt-addr-sheet::-webkit-scrollbar{display:none;}",

      // It rises from the edge it is anchored to and decelerates into place
      // rather than appearing at full size and scaling. Long enough that the eye
      // follows the movement — the old .26s pop was over before it could.
      "#pt-addr-sheet.pt-in{animation:pt-sheet-in .46s var(--ease) forwards;}",
      "@keyframes pt-sheet-in{from{opacity:0;transform:translate3d(0,100%,0)}60%{opacity:1}to{opacity:1;transform:translate3d(0,0,0)}}",
      "#pt-addr-ov.pt-closing #pt-addr-sheet{animation:pt-sheet-out .2s cubic-bezier(.4,0,1,1) forwards;}",
      "@keyframes pt-sheet-out{from{opacity:1;transform:translate3d(0,0,0)}to{opacity:0;transform:translate3d(0,14%,0)}}",

      // The contents arrive just behind the panel, a few frames apart, so it
      // reads as one movement with depth instead of a finished slab sliding in.
      "@keyframes pt-rise{from{opacity:0;transform:translate3d(0,9px,0)}to{opacity:1;transform:none}}",
      "#pt-addr-sheet.pt-in>#pt-addr-grip{animation:pt-rise .34s var(--ease) .05s both;}",
      "#pt-addr-sheet.pt-in>.pt-addr-eyebrow{animation:pt-rise .34s var(--ease) .09s both;}",
      "#pt-addr-sheet.pt-in>h3{animation:pt-rise .34s var(--ease) .12s both;}",
      "#pt-addr-sheet.pt-in>.pt-addr-sub{animation:pt-rise .34s var(--ease) .15s both;}",
      // Whichever of the two views is showing. Replayed on the confirm -> edit
      // swap too, where the sheet is already up and nothing else would move.
      ".pt-reveal{animation:pt-rise .38s var(--ease) .1s both;}",

      // Centred on a wide screen there is no edge to rise from, so it lifts and
      // settles instead. Re-declaring the keyframes inside the query is what
      // swaps the motion: when the query matches, its @keyframes block wins.
      "@media(min-width:520px){#pt-addr-ov{align-items:center;padding:16px;}",
      "#pt-addr-sheet{border-radius:26px;box-shadow:0 30px 70px -20px rgba(14,18,32,.5);",
      "transform-origin:center;transform:translate3d(0,18px,0) scale(.97);}",
      "@keyframes pt-sheet-in{from{opacity:0;transform:translate3d(0,18px,0) scale(.97)}to{opacity:1;transform:none}}",
      "@keyframes pt-sheet-out{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(0,8px,0) scale(.985)}}}",

      // Grab handle
      "#pt-addr-grip{width:38px;height:4px;border-radius:99px;background:#D5DDE8;margin:0 auto 16px;}",

      // Header
      ".pt-addr-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:.66rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:var(--r);margin-bottom:9px;}",
      ".pt-addr-eyebrow svg{width:13px;height:13px;}",
      "#pt-addr-sheet h3{margin:0 0 4px;font-size:1.32rem;font-weight:800;letter-spacing:-.02em;color:var(--ink);}",
      "#pt-addr-sheet .pt-addr-sub{margin:0 0 18px;font-size:.86rem;line-height:1.4;color:var(--muted);}",
      ".pt-hide{display:none!important;}",

      // Order context comes before the address fields. A cold visitor should
      // never have to hand over their full address while wondering which pack
      // they selected, what it costs, or when payment happens.
      "#pt-addr-summary{border:1px solid var(--line);border-radius:16px;padding:14px 15px;margin:0 0 16px;background:#fff;}",
      ".pt-addr-summary-top{display:flex;align-items:center;justify-content:space-between;gap:12px;}",
      ".pt-addr-summary-main{flex:1;min-width:0;}",
      "#pt-addr-summary-img{flex:none;width:64px;height:64px;object-fit:contain;border-radius:12px;border:1px solid var(--line);background:#fff;}",
      ".pt-addr-summary-label{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;}",
      "#pt-addr-summary-name{font-size:.9rem;line-height:1.35;font-weight:800;color:var(--ink);}",
      "#pt-addr-summary-price{flex:0 0 auto;font-size:1.08rem;font-weight:900;color:var(--navy);}",
      "#pt-addr-summary-price del{display:block;font-size:.72rem;font-weight:600;color:var(--muted);}",
      "#pt-addr-summary-price number-flow{font-variant-numeric:tabular-nums;}",
      // The coupon: a tag, the code in a dashed box (the shape every coupon code
      // has), a note that it is applied, and the saving on the right.
      ".pt-addr-summary-offer{display:flex;align-items:center;gap:12px;margin:12px 0 0;padding:11px 12px;border:1px solid #BBF7D0;border-radius:14px;background:#F0FDF4;color:#15803D;}",
      ".pt-offer-ic{flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:#DCFCE7;}",
      ".pt-offer-ic svg{width:18px;height:18px;}",
      ".pt-offer-b{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px;}",
      ".pt-offer-code{max-width:100%;padding:2px 9px;border:1.5px dashed #4ADE80;border-radius:7px;background:#fff;font-size:.8rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
      ".pt-offer-note{font-size:.7rem;font-weight:700;color:#166534;}",
      ".pt-offer-save{flex:none;padding:5px 11px;border-radius:999px;background:#15803D;color:#fff;font-size:.72rem;font-weight:800;letter-spacing:.01em;}",
      ".pt-addr-summary-terms{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:11px;padding-top:10px;border-top:1px dashed var(--line);font-size:.7rem;font-weight:700;color:#41506A;}",
      ".pt-addr-summary-terms span:before{content:'✓';color:#15803D;font-weight:900;margin-right:5px;}",
      ".pt-addr-summary-pay{margin:12px 0 0;font-size:.72rem;line-height:1.4;color:var(--muted);}",
      // What the total is made of: slate-50 panel, savings in green, the total
      // set apart by a dashed rule and a heavier weight.
      "#pt-addr-breakdown{margin:14px 0 0;padding:12px 14px;border-radius:14px;background:var(--field);font-size:.8rem;color:#41506A;}",
      ".pt-addr-bk-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:3px 0;}",
      ".pt-addr-bk-row dt,.pt-addr-bk-row dd{margin:0;}",
      ".pt-addr-bk-row dd{font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--ink);}",
      ".pt-addr-bk-row.pt-save dd{color:#15803D;font-weight:800;}",
      ".pt-addr-bk-row.pt-total{margin-top:6px;padding-top:9px;border-top:1px dashed #CBD5E1;font-size:.95rem;font-weight:800;color:var(--ink);}",
      ".pt-addr-bk-row.pt-total dd{font-size:1.1rem;font-weight:900;}",
      // Colour carries meaning, as in the Stitch breakdown: a discount in red,
      // what costs nothing in green, everything else in ink.
      ".pt-addr-bk-row.pt-promo dt,.pt-addr-bk-row.pt-promo dd{color:#B91C1C;font-weight:700;}",
      ".pt-addr-note-lock{display:flex;align-items:flex-start;gap:7px;margin:8px 0 0;font-size:.72rem;font-weight:600;line-height:1.4;color:var(--muted);}",
      ".pt-addr-note-lock svg{flex:none;width:14px;height:14px;margin-top:1px;color:var(--ink);}",
      // The extra, as a card you tick.
      "#pt-addr-addon{display:flex;align-items:center;gap:11px;margin:14px 0 0;padding:12px;border:1.5px solid var(--line);border-radius:14px;background:#fff;cursor:pointer;transition:border-color .15s,background-color .15s;}",
      "#pt-addr-addon:has(input:checked){border-color:var(--navy);background:var(--field);}",
      "#pt-addr-addon input{flex:none;width:18px;height:18px;margin:0;accent-color:var(--navy);}",
      "#pt-addr-addon img{flex:none;width:56px;height:56px;object-fit:cover;border-radius:12px;background:var(--field);}",
      ".pt-addr-addon-b{min-width:0;}",
      ".pt-addr-addon-b strong{display:block;font-size:.84rem;line-height:1.3;color:var(--ink);}",
      ".pt-addr-addon-b small{display:block;margin-top:2px;font-size:.72rem;line-height:1.35;color:var(--muted);}",
      // After the button: what happens next.
      "#pt-addr-assure{display:flex;align-items:center;gap:12px;margin:14px 0 0;padding:10px;border-radius:14px;background:var(--field);}",
      "#pt-addr-assure img{flex:none;width:56px;height:70px;object-fit:cover;border-radius:10px;}",
      "#pt-addr-assure strong{display:block;font-size:.8rem;line-height:1.3;color:var(--ink);}",
      "#pt-addr-assure span{display:block;margin-top:2px;font-size:.74rem;line-height:1.35;color:var(--muted);}",
      "#pt-addr-paychoice{display:grid;gap:8px;margin-top:11px;padding:0;border:0;}",
      ".pt-addr-payopt{display:flex;align-items:center;gap:10px;border:1.5px solid var(--line);border-radius:14px;padding:12px 13px;background:#fff;font-size:.84rem;font-weight:700;color:var(--ink);cursor:pointer;transition:border-color .15s,background-color .15s;}",
      ".pt-addr-payopt input{accent-color:var(--navy);margin:0;}",
      ".pt-addr-payopt small{display:block;margin-top:2px;font-size:.72rem;font-weight:600;color:var(--muted);}",
      ".pt-addr-payopt:has(input:checked){border-color:var(--navy);background:var(--field);}",
      ".pt-addr-optin{display:flex;align-items:flex-start;gap:9px;margin-top:11px;font-size:.76rem;font-weight:600;color:var(--muted);cursor:pointer;line-height:1.35;}",
      ".pt-addr-optin input{accent-color:var(--navy);margin:2px 0 0;flex:0 0 auto;}",

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
      // Only the right-hand half of a pair gets the gutter; PIN wraps to its own
      // row and must line up with the full-width fields above it.
      ".pt-addr-f.pt-half-r{margin-left:8px;}",
      ".pt-addr-f label{display:block;font-size:.72rem;font-weight:700;letter-spacing:.01em;color:#374151;margin-bottom:5px;}",
      ".pt-req{color:var(--r);margin-left:3px;font-weight:800;}",
      ".pt-addr-f input,.pt-addr-f select{width:100%;box-sizing:border-box;padding:12px 13px;border:1.5px solid var(--field);border-radius:14px;font-size:.94rem;color:var(--ink);background:var(--field);outline:none;transition:border-color .15s,box-shadow .15s,background-color .15s;}",
      ".pt-addr-f input::placeholder{color:#a8adb8;}",
      ".pt-addr-f input:focus,.pt-addr-f select:focus{border-color:var(--navy);background-color:#fff;box-shadow:0 0 0 3.5px rgba(11,19,43,.08);}",
      // The +91 sits inside the field's own box so the pair reads as one control.
      ".pt-addr-phone{display:flex;align-items:center;border:1.5px solid var(--field);border-radius:14px;background:var(--field);transition:border-color .15s,box-shadow .15s,background-color .15s;}",
      ".pt-addr-phone:focus-within{border-color:var(--navy);background:#fff;box-shadow:0 0 0 3.5px rgba(11,19,43,.08);}",
      ".pt-addr-phone span{padding:0 4px 0 13px;font-size:.94rem;font-weight:700;color:var(--ink);}",
      ".pt-addr-f .pt-addr-phone input{border:0;background:transparent;box-shadow:none;padding-left:8px;}",
      // Numbered steps. Counters skip anything that is display:none, so the
      // payment step only takes a number when Cash on Delivery is on offer.
      "#pt-addr-form{counter-reset:pt-step;}",
      ".pt-addr-step{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:16px 0 8px;}",
      "#pt-addr-err+.pt-addr-step{margin-top:4px;}",
      ".pt-addr-step-t{font-size:.84rem;font-weight:800;color:var(--ink);}",
      ".pt-addr-step-t:before{counter-increment:pt-step;content:'Step ' counter(pt-step) ': ';color:var(--muted);font-weight:700;}",
      ".pt-addr-hint{font-size:.7rem;font-weight:600;color:var(--muted);}",
      // The step heading already says "Your mobile number", so the box's own
      // label stays for screen readers and is not drawn a second time.
      ".pt-addr-f:has(.pt-addr-phone)>label{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}",
      "#pt-addr-paychoice{margin:16px 0 4px;}",
      "#pt-addr-paychoice legend{padding:0;margin-bottom:8px;}",
      // Native menu, custom chevron. The empty option is the only invalid value
      // a required select can hold, so :invalid is exactly "nothing chosen yet".
      ".pt-addr-f select{-webkit-appearance:none;appearance:none;padding-right:38px;font-family:inherit;line-height:1.3;background:var(--field) url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2341506A' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\") no-repeat right 12px center/18px;}",
      ".pt-addr-f select:invalid{color:#a8adb8;}",
      ".pt-addr-f select option{color:var(--ink);}",
      "#pt-addr-sugg{margin-top:6px;border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;box-shadow:0 6px 18px rgba(3,22,45,.08);}",
      "#pt-addr-sugg button{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;padding:10px 13px;font:inherit;font-size:.82rem;color:#111827;cursor:pointer;}",
      "#pt-addr-sugg button:last-child{border-bottom:0;}",
      "#pt-addr-sugg small{display:block;color:var(--muted);font-size:.72rem;margin-top:2px;}",
      "#pt-addr-err,#pt-addr-otp-err{display:none;background:#fdecec;color:#c0271b;font-size:.8rem;font-weight:600;padding:10px 13px;border-radius:11px;margin-bottom:13px;}",
      "#pt-addr-err.pt-show,#pt-addr-otp-err.pt-show{display:block;}",
      "#pt-addr-otp-note{display:none;background:#fff4e5;color:#8a4b00;font-size:.8rem;font-weight:600;padding:10px 13px;border-radius:11px;margin-bottom:13px;}",
      "#pt-addr-otp-note.pt-show{display:block;}",
      // The COD code: one wide field, digits spaced so a misread is visible.
      "#pt-addr-code{font-size:1.3rem;font-weight:800;letter-spacing:.45em;text-align:center;font-variant-numeric:tabular-nums;}",

      // Buttons
      // Red pill, as on the page behind it: this is the conversion control and
      // the Stitch system keeps red for exactly that. The glow is the button's
      // own colour, so it does not read as a mistake under it.
      ".pt-addr-primary{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;padding:16px;border:none;border-radius:999px;margin-top:16px;",
      "background:var(--r);color:#fff;font-size:1rem;font-weight:800;letter-spacing:.01em;cursor:pointer;",
      "box-shadow:0 8px 24px -4px rgba(255,59,48,.45);transition:transform .12s ease,box-shadow .2s ease,background .2s ease;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-primary svg{width:19px;height:19px;}",
      ".pt-addr-primary:hover{background:var(--r-press);box-shadow:0 10px 28px -4px rgba(255,59,48,.55);}",
      ".pt-addr-primary:active{transform:scale(.975);}",
      ".pt-addr-primary:disabled{opacity:.65;cursor:default;box-shadow:none;transform:none;}",
      ".pt-addr-secondary{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:13px;margin-top:10px;",
      "border:1.5px solid var(--line);border-radius:15px;background:#fff;color:#374151;font-size:.9rem;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-secondary svg{width:16px;height:16px;color:var(--muted);}",
      ".pt-addr-secondary:hover{background:#EEF3F9;border-color:#D3DCE7;}",
      ".pt-addr-secondary:active{background:#E6ECF4;}",
      ".pt-addr-secondary:disabled{opacity:.6;cursor:default;background:#fff;border-color:var(--line);}",
      ".pt-addr-link{width:100%;padding:12px;margin-top:6px;border:none;background:none;color:var(--muted);font-size:.85rem;font-weight:600;cursor:pointer;border-radius:12px;-webkit-tap-highlight-color:transparent;}",
      ".pt-addr-link:hover{color:#374151;}",

      // Secure footer
      "#pt-addr-secure{display:flex;align-items:center;justify-content:center;gap:6px;margin:16px 0 2px;color:#9aa0ac;font-size:.72rem;font-weight:600;}",
      "#pt-addr-secure svg{width:13px;height:13px;}",
      "#pt-addr-note{margin:9px 0 0;font-size:.72rem;color:#a3a8b3;text-align:center;}",

      // Reduced motion. Every animation here fills forwards, so collapsing the
      // durations lands each element on its final state on the first frame —
      // the sheet still opens and closes, it just does not travel.
      "@media(prefers-reduced-motion:reduce){.pt-addr-primary{transition:none;}",
      "#pt-addr-ov.pt-open,#pt-addr-ov.pt-closing,#pt-addr-ov.pt-closing #pt-addr-sheet,",
      "#pt-addr-sheet.pt-in,#pt-addr-sheet.pt-in>*,.pt-reveal{animation-duration:.01ms!important;animation-delay:0s!important;}}"
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
    // Name, mobile, address and the COD code: never in a session replay.
    ov.setAttribute("data-clarity-mask", "True");

    var fieldRows = {};
    FIELDS.forEach(function (f) {
      var half = f.key === "city" || f.key === "state";
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
      var control;
      if (f.type === "select") {
        // The empty first option is what `required` rejects, so an untouched
        // dropdown reads as invalid and shows the placeholder colour.
        control = '<select id="pt-addr-' + f.key + '"' + (f.auto ? ' autocomplete="' + f.auto + '"' : "") + req + ">" +
          '<option value="">' + f.ph + "</option>" +
          f.options.map(function (o) { return "<option>" + o + "</option>"; }).join("") +
          "</select>";
      } else if (f.key === "phone") {
        // The +91 is a label on the box, not part of the value: readForm and
        // validate still see the ten digits and nothing else.
        control = '<div class="pt-addr-phone"><span aria-hidden="true">+91</span><input ' + attrs + req + "></div>";
      } else {
        control = "<input " + attrs + req + ">";
      }
      fieldRows[f.key] = '<div class="pt-addr-f' + (half ? " pt-half" : "") + (f.key === "state" ? " pt-half-r" : "") + '"><label for="pt-addr-' + f.key + '">' +
        f.label + star + "</label>" + control + "</div>";
    });
    // Mobile first, then payment, then where it goes: the order the Stitch
    // checkout uses, and the one that asks for the smallest thing first. The
    // numbers are CSS counters, so a step that is hidden (payment, when Cash on
    // Delivery is not offered) takes no number and the rest still count 1, 2.
    var phoneRow = fieldRows.phone;
    var addressRows = ["fullName", "pincode", "line1", "line2", "city", "state"].map(function (k) { return fieldRows[k]; }).join("");

    var secure =
      '<div id="pt-addr-secure">' + IC.lock + '<span class="pt-addr-secure-t">Secured by Razorpay · UPI · Cards · Net Banking</span></div>';

    ov.innerHTML =
      '<div id="pt-addr-sheet" role="dialog" aria-modal="true" aria-label="Delivery address">' +
      '<div id="pt-addr-grip"></div>' +
      '<span class="pt-addr-eyebrow" id="pt-addr-eyebrow">' + IC.pin + '<span>Delivery</span></span>' +
      '<h3 id="pt-addr-title">Delivery address</h3>' +
      '<p class="pt-addr-sub" id="pt-addr-sub">Where should we ship your official ParkTag sticker?</p>' +
      '<div id="pt-addr-summary" class="pt-hide" aria-label="Order summary">' +
      '<div class="pt-addr-summary-top"><img id="pt-addr-summary-img" class="pt-hide" alt="" width="64" height="64" decoding="async"><div class="pt-addr-summary-main"><div class="pt-addr-summary-label">Your order</div><div id="pt-addr-summary-name"></div></div><div id="pt-addr-summary-price"></div></div>' +
      // The Premium year is left off here on purpose: it is product detail for
      // after the order (the Meta review), and this row is for what a first-time
      // buyer needs to trust before handing over an address.
      '<div class="pt-addr-summary-terms"><span>Free delivery</span><span>7-day replacement</span></div>' +
      '</div>' +

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
      '<div class="pt-addr-step"><span class="pt-addr-step-t">Your mobile number</span><span class="pt-addr-hint">For delivery updates</span></div>' +
      phoneRow +
      '<p class="pt-addr-note-lock">' + IC.lock + '<span>Kept private. Shared only with the courier so your order reaches you.</span></p>' +
      '<fieldset id="pt-addr-paychoice" class="pt-hide"><legend class="pt-addr-step-t">Payment method</legend>' +
      '<label class="pt-addr-payopt"><input type="radio" name="pt-addr-pay" value="online"><span id="pt-addr-pay-online"></span></label>' +
      '<label class="pt-addr-payopt"><input type="radio" name="pt-addr-pay" value="cod"><span id="pt-addr-pay-cod"></span></label>' +
      '</fieldset>' +
      // The extra the page offers, between payment and address: a tick, its
      // photo, what it is and what it costs. Hidden unless the caller offers one.
      '<label id="pt-addr-addon" class="pt-hide"><input type="checkbox" id="pt-addr-addon-check">' +
      '<img id="pt-addr-addon-img" class="pt-hide" alt="" width="56" height="56" decoding="async" loading="lazy">' +
      '<span class="pt-addr-addon-b"><strong id="pt-addr-addon-t"></strong><small id="pt-addr-addon-d"></small></span></label>' +
      '<div class="pt-addr-step"><span class="pt-addr-step-t">Delivery address</span></div>' +
      addressRows +
      // Only with an order to show: what the total is made of, then when the
      // money is taken, then the one tick that needs a decision.
      '<div id="pt-addr-checkout" class="pt-hide">' +
      '<dl id="pt-addr-breakdown" aria-label="Price breakdown"></dl>' +
      '<p class="pt-addr-summary-pay" id="pt-addr-summary-pay">No payment is taken on this step. Continue to pay securely using UPI, cards or net banking.</p>' +
      // Meta reclassified the abandoned-cart template as MARKETING, which needs
      // recorded opt-in, so the reminder can only reach a buyer who has this on.
      //
      // Ticked by default, by the owner's decision on 2026-09-23. The trade is
      // written down rather than hidden: a pre-ticked box is weaker consent
      // than a deliberate tick, so the stamp records WHICH it was, and the box
      // sits in plain sight above the button with one tap to turn it off.
      '<label class="pt-addr-optin"><input type="checkbox" id="pt-addr-optin" checked><span>Message me on WhatsApp about this order and ParkTag offers. Untick if you would rather not.</span></label>' +
      '</div>' +
      '<button id="pt-addr-save" class="pt-addr-primary" type="button">' + IC.lock + "Save &amp; continue to pay</button>" +
      '<button id="pt-addr-cancel" class="pt-addr-link" type="button">Cancel</button>' +
      '<p id="pt-addr-note">Saved to your profile. You won\'t need to enter it again.</p>' +
      // What happens after the tap. Delhivery is the courier orders are booked
      // with (lib/integrations/delhivery.js) and /track-order follows them, so
      // both are true; a delivery time is not promised because none is.
      '<div id="pt-addr-assure" class="pt-hide"><img src="/images/proof/customer-handover.webp" alt="" width="56" height="70" loading="lazy" decoding="async">' +
      '<div><strong>7-day replacement &bull; Free delivery</strong><span>Shipped with Delhivery. Track your order any time.</span></div></div>' +
      secure +
      "</div>" +

      // ── Code view (guest Cash on Delivery) ──
      '<div id="pt-addr-otp" class="pt-hide">' +
      '<div id="pt-addr-otp-err" role="alert"></div>' +
      '<div id="pt-addr-otp-note" role="status"></div>' +
      '<div class="pt-addr-f"><label for="pt-addr-code">6-digit code<span class="pt-req" aria-hidden="true">*</span></label>' +
      '<input type="text" id="pt-addr-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-describedby="pt-addr-sub" required aria-required="true"></div>' +
      '<button id="pt-addr-verify" class="pt-addr-primary" type="button">' + IC.lock + "Verify &amp; place order</button>" +
      '<button id="pt-addr-resend" class="pt-addr-secondary" type="button" disabled>Resend code</button>' +
      '<button id="pt-addr-back" class="pt-addr-link" type="button">Change address or mobile number</button>' +
      "</div>" +
      "</div>";

    document.body.appendChild(ov);

    els = {
      ov: ov,
      sheet: ov.querySelector("#pt-addr-sheet"),
      title: ov.querySelector("#pt-addr-title"),
      sub: ov.querySelector("#pt-addr-sub"),
      summary: ov.querySelector("#pt-addr-summary"),
      summaryName: ov.querySelector("#pt-addr-summary-name"),
      summaryImg: ov.querySelector("#pt-addr-summary-img"),
      summaryPrice: ov.querySelector("#pt-addr-summary-price"),
      summaryPay: ov.querySelector("#pt-addr-summary-pay"),
      checkout: ov.querySelector("#pt-addr-checkout"),
      assure: ov.querySelector("#pt-addr-assure"),
      addon: ov.querySelector("#pt-addr-addon"),
      addonCheck: ov.querySelector("#pt-addr-addon-check"),
      addonImg: ov.querySelector("#pt-addr-addon-img"),
      addonT: ov.querySelector("#pt-addr-addon-t"),
      addonD: ov.querySelector("#pt-addr-addon-d"),
      breakdown: ov.querySelector("#pt-addr-breakdown"),
      eyebrowText: ov.querySelector("#pt-addr-eyebrow span"),
      optIn: ov.querySelector("#pt-addr-optin"),
      payChoice: ov.querySelector("#pt-addr-paychoice"),
      payOnline: ov.querySelector("#pt-addr-pay-online"),
      payCod: ov.querySelector("#pt-addr-pay-cod"),
      secureTexts: ov.querySelectorAll(".pt-addr-secure-t"),
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
      note: ov.querySelector("#pt-addr-note"),
      otp: ov.querySelector("#pt-addr-otp"),
      otpErr: ov.querySelector("#pt-addr-otp-err"),
      otpNote: ov.querySelector("#pt-addr-otp-note"),
      code: ov.querySelector("#pt-addr-code"),
      verify: ov.querySelector("#pt-addr-verify"),
      resend: ov.querySelector("#pt-addr-resend"),
      inputs: {}
    };
    FIELDS.forEach(function (f) { els.inputs[f.key] = ov.querySelector("#pt-addr-" + f.key); });

    // Digits-only guard for phone + pincode.
    ["phone", "pincode"].forEach(function (k) {
      els.inputs[k].addEventListener("input", function () {
        this.value = this.value.replace(/[^0-9]/g, "");
      });
    });
    els.inputs.pincode.addEventListener("input", function () {
      if (/^[1-9][0-9]{5}$/.test(this.value)) {
        lookupPin(this.value);
        warmCheckout(); // the courier can be asked about this pincode now
      }
    });

    // Street suggestions under House / Flat, Street, as other checkouts do.
    els.sugg = document.createElement("div");
    els.sugg.id = "pt-addr-sugg";
    els.sugg.setAttribute("role", "listbox");
    els.sugg.classList.add("pt-hide");
    els.inputs.line1.parentNode.appendChild(els.sugg);
    els.inputs.line1.setAttribute("autocomplete", "off"); // our list, not the browser's, over this box
    els.inputs.line1.addEventListener("input", function () {
      clearTimeout(suggTimer);
      var q = this.value.trim();
      if (q.length < 3) { hideSugg(); return; }
      suggTimer = setTimeout(function () { fetchSugg(q); }, 300);
    });
    els.inputs.line1.addEventListener("blur", function () { setTimeout(hideSugg, 150); });
    // pointerdown, not click: it lands before the input's blur hides the list.
    els.sugg.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;
      e.preventDefault();
      pickSugg(suggList[Number(btn.dataset.i)]);
    });

    // Which field a buyer got to, once per field per open: Clarity showed
    // people leaving a half-filled form, and this says where. The field's
    // NAME only, never what was typed.
    FIELDS.forEach(function (f) {
      els.inputs[f.key].addEventListener("change", function () {
        if (!this.value || trackedFields[f.key]) return;
        trackedFields[f.key] = true;
        if (window.ptTrack) window.ptTrack("checkout_field", { field_name: f.key, method: guestMode ? "guest" : "owner" });
        if (typeof window.clarity === "function") window.clarity("event", "checkout_field_" + f.key);
      });
    });

    // Confirm view: proceed with the already-saved address (no re-save needed).
    els.deliver.addEventListener("click", function () { close(true); });
    // Confirm view: they've moved — open the prefilled form to change it.
    els.edit.addEventListener("click", function () { showForm(savedAddress); });

    // Everything typed or chosen in the sheet is kept for a reload. On the
    // overlay, so it runs after the payment choice's own handler has updated
    // payChoice (that listener sits on an inner element and fires first).
    ov.addEventListener("input", draftKeep);
    ov.addEventListener("change", draftKeep);
    // And once the form is complete, the payment is seconds away.
    ov.addEventListener("input", warmIfComplete);
    ov.addEventListener("change", warmIfComplete);

    els.save.addEventListener("click", onSave);
    els.code.addEventListener("input", function () {
      this.value = this.value.replace(/[^0-9]/g, "");
      // A pasted or autofilled code submits itself.
      if (this.value.length === 6 && !els.verify.disabled) onVerify();
    });
    els.code.addEventListener("keydown", function (e) { if (e.key === "Enter") onVerify(); });
    els.verify.addEventListener("click", onVerify);
    els.resend.addEventListener("click", onResend);
    // Back to the form with what they typed, to fix a wrong number.
    ov.querySelector("#pt-addr-back").addEventListener("click", function () { showForm(codAddress); });
    els.payChoice.addEventListener("change", function (e) { setPayChoice(e.target.value); });
    els.addonCheck.addEventListener("change", function () { setAddOn(this.checked); });
    ov.querySelector("#pt-addr-cancel").addEventListener("click", function () { close(false); });
    ov.querySelector("#pt-addr-cancel2").addEventListener("click", function () { close(false); });
    ov.addEventListener("click", function (e) { if (e.target === ov) close(false); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("pt-open")) close(false);
    });
    // Back (button, gesture or swipe) while the sheet is up is a dismissal.
    // The flag is cleared first so the history.back() in close() below is
    // never mistaken for a second press.
    window.addEventListener("popstate", function () {
      if (!historyEntry) return;
      historyEntry = false;
      if (resolver) close(false);
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

  // A picture path on this site and nowhere else: the caller is our own page,
  // but the sheet is shared and the value ends up in an <img src>.
  function ownImage(path) {
    return typeof path === "string" && /^\/images\/[\w./-]+$/.test(path) && path.indexOf("..") < 0;
  }

  // The summary the caller gave, with the extra added when it is ticked: its
  // price on the online total, the list price and the Cash on Delivery total,
  // and a line for the breakdown to show.
  function currentSummary() {
    if (!orderSummary || !addOnOffer || !addOnOn) return orderSummary;
    var add = Number(addOnOffer.amountPaise) || 0;
    var s = Object.assign({}, orderSummary);
    s.amountPaise = Number(orderSummary.amountPaise) + add;
    if (orderSummary.mrpPaise != null && Number.isFinite(Number(orderSummary.mrpPaise))) {
      s.mrpPaise = Number(orderSummary.mrpPaise) + add;
    }
    if (orderSummary.cod) {
      s.cod = Object.assign({}, orderSummary.cod, { amountPaise: Number(orderSummary.cod.amountPaise) + add });
    }
    s.addOnLine = { name: String(addOnOffer.name || "Add-on"), amountPaise: add };
    return s;
  }

  function showAddOnCard() {
    var ok = !!(addOnOffer && priced && Number(addOnOffer.amountPaise) > 0 && addOnOffer.name);
    els.addon.classList.toggle("pt-hide", !ok);
    if (!ok) return;
    els.addonCheck.checked = addOnOn;
    els.addonT.textContent = addOnOffer.name + " (+" + inr(Number(addOnOffer.amountPaise)) + ")";
    els.addonD.textContent = addOnOffer.description || "";
    var withPhoto = ownImage(addOnOffer.image);
    els.addonImg.classList.toggle("pt-hide", !withPhoto);
    if (withPhoto) els.addonImg.src = addOnOffer.image;
  }

  function setAddOn(on) {
    addOnOn = !!on;
    if (addOnOffer && typeof addOnOffer.onChange === "function") {
      try { addOnOffer.onChange(addOnOn); } catch (_) { /* the page's tick is a convenience */ }
    }
    // Same pricing, one more line. showOrderSummary resets the method to
    // online, so the buyer's choice is put back.
    var keep = payChoice;
    showOrderSummary(currentSummary());
    setPayChoice(keep);
    draftKeep();
  }

  function showOrderSummary(summary) {
    if (!els || !els.summary) return;
    var name = summary && typeof summary.name === "string" ? summary.name.trim() : "";
    var amountPaise = summary && Number(summary.amountPaise);
    if (!name || !Number.isFinite(amountPaise) || amountPaise <= 0) {
      els.summary.classList.add("pt-hide");
      els.checkout.classList.add("pt-hide");
      els.assure.classList.add("pt-hide");
      els.eyebrowText.textContent = "Delivery";
      els.summaryName.textContent = "";
      els.summaryPrice.textContent = "";
      els.summaryImg.classList.add("pt-hide");
      els.payChoice.classList.add("pt-hide");
      priced = null;
      payPrices = null;
      setPayChoice("online");
      return;
    }
    els.summaryName.textContent = name;
    // The pack's picture, when the caller has one. Only a path on this site:
    // the caller is our own page, but the sheet is shared and the value ends up
    // in an <img src>.
    var image = summary.image;
    if (ownImage(image)) {
      els.summaryImg.src = image;
      els.summaryImg.classList.remove("pt-hide");
    } else {
      els.summaryImg.classList.add("pt-hide");
    }
    renderSummaryPrice(amountPaise, Number(summary.mrpPaise));

    // Only a guest can choose COD (it is guest create-order that takes it),
    // and only when the caller priced it, above the online amount.
    var cod = summary.cod;
    var codPaise = guestMode && cod ? Number(cod.amountPaise) : NaN;
    var codOn = Number.isFinite(codPaise) && codPaise > amountPaise;
    els.payChoice.classList.toggle("pt-hide", !codOn);
    if (codOn) {
      els.payOnline.textContent = "Pay online · " + inr(amountPaise);
      // Fee on its own line, so a phone never wraps the price mid-bracket.
      els.payCod.textContent = "Cash on delivery · " + inr(codPaise);
      var codNote = document.createElement("small");
      codNote.textContent = "Includes " + inr(Number(cod.feePaise)) + " COD fee";
      els.payCod.appendChild(codNote);
    }
    payPrices = codOn ? { online: amountPaise, cod: codPaise, mrp: Number(summary.mrpPaise) } : null;
    priced = {
      name: name,
      amount: amountPaise,
      mrp: Number(summary.mrpPaise),
      fee: codOn ? Number(cod.feePaise) || 0 : 0,
      addOn: summary.addOnLine || null
    };
    if (codOn) loadNumberFlow();
    setPayChoice("online");

    // Up to two badges: a promo code, and a friend's link. Both come off the
    // online price only, so setPayChoice hides them beside Cash on Delivery.
    els.summary.querySelectorAll(".pt-addr-summary-offer").forEach(function (el) { el.remove(); });
    // Drawn as a coupon (a ticket with a tag, the code and the saving), not a
    // pill: a discount that has been applied should be the first thing noticed.
    var saved = Number(summary.mrpPaise) - amountPaise;
    [summary.offerLabel, summary.referralLabel].forEach(function (label) {
      if (!label) return;
      var badge = document.createElement("span");
      badge.className = "pt-addr-summary-offer";
      var icon = document.createElement("span");
      icon.className = "pt-offer-ic";
      icon.innerHTML = IC.tag;
      // "LAUNCH auto-applied" -> the code on its own in a dashed box, the way a
      // coupon code is shown anywhere else, and the rest as a small note under
      // it. A label that is not in that shape (a friend's link) is shown whole.
      var parts = /^(\S+)\s+(auto-)?applied$/i.exec(label);
      var body = document.createElement("span");
      body.className = "pt-offer-b";
      var code = document.createElement("span");
      code.className = "pt-offer-code";
      code.textContent = parts ? parts[1] : label;
      var note = document.createElement("span");
      note.className = "pt-offer-note";
      note.textContent = parts ? (parts[2] ? "Applied automatically" : "Coupon applied") : "Applied";
      body.append(code, note);
      badge.append(icon, body);
      // The saving rides on the first coupon only: it is the whole discount
      // between list price and what is charged, not one coupon's share.
      if (saved > 0 && !els.summary.querySelector(".pt-offer-save")) {
        var save = document.createElement("span");
        save.className = "pt-offer-save";
        save.textContent = "You save " + inr(saved);
        badge.appendChild(save);
      }
      els.summary.appendChild(badge);
    });
    els.summary.classList.remove("pt-hide");
    els.checkout.classList.remove("pt-hide");
    els.assure.classList.remove("pt-hide");
    els.eyebrowText.textContent = "Secure checkout";
  }

  function inr(paise) {
    return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
  }

  // The total rolls between the online and COD prices instead of jumping, so
  // the difference is seen. NumberFlow is self-hosted because the CSP allows no
  // script CDN. Decoration only: until (or unless) it loads, plain text shows.
  var INR_WHOLE = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  var numberFlow = null;
  var numberFlowLoad = null;
  // Fetched the first time a summary with two prices opens, not on page load:
  // most sheets never need it. Whatever price is already showing is upgraded
  // in place once it lands.
  //
  // Only where its stylesheet lays out correctly. NumberFlow pulls the digits
  // 0.5em to the left with a negative margin and pushes them back with a
  // padding written in CSS round(). A browser without round() (Chrome and
  // Android WebView before 125, Samsung Internet before 27) drops the padding
  // and keeps the margin, so the first digit slides under the rupee sign and
  // ₹399 reads as ₹99. Those browsers keep the plain text, which is correct.
  function numberFlowFits() {
    try {
      return typeof CSS !== "undefined" && typeof CSS.supports === "function" &&
        CSS.supports("padding", "round(nearest, 1px, 1px)");
    } catch (e) { return false; }
  }
  function loadNumberFlow() {
    if (numberFlowLoad || !numberFlowFits()) return;
    numberFlowLoad = import("/scripts/vendor/number-flow.js").then(function (m) {
      m.define("number-flow", m.default);
      numberFlow = m;
      if (els && payPrices) {
        renderSummaryPrice(payChoice === "cod" ? payPrices.cod : payPrices.online, payPrices.mrp);
      }
    }).catch(function () { /* plain text it is */ });
  }

  function renderSummaryPrice(amountPaise, mrpPaise) {
    var hasWas = Number.isFinite(mrpPaise) && mrpPaise > amountPaise;
    var flow = els.summaryPrice.querySelector("number-flow");
    if (!flow) {
      els.summaryPrice.textContent = "";
      if (numberFlow) {
        flow = document.createElement("number-flow");
        els.summaryPrice.appendChild(flow);
      } else {
        els.summaryPrice.appendChild(document.createTextNode(inr(amountPaise)));
      }
    }
    var was = els.summaryPrice.querySelector("del");
    if (hasWas && !was) {
      was = document.createElement("del");
      els.summaryPrice.insertBefore(was, els.summaryPrice.firstChild);
    }
    if (was && !hasWas) was.remove();
    if (hasWas) was.textContent = "MRP " + inr(mrpPaise);
    // Same element, new value: that is what makes it roll.
    if (flow) {
      flow.data = numberFlow.formatToData(Math.round(amountPaise / 100), INR_WHOLE);
      // The digits live in a shadow root that screen readers do not read.
      flow.setAttribute("role", "img");
      flow.setAttribute("aria-label", inr(amountPaise));
    }
  }

  // Everything that has to read true for the chosen method: the total, the
  // "when do I pay" line, the Razorpay footer and the button.
  // Instagram and Facebook open ad clicks in their own in-app browser, where
  // the hand-off to a UPI app is least reliable. Only an online payer is told.
  var META_INAPP = /FBAN|FBAV|Instagram/i.test(navigator.userAgent || "");
  function setPayChoice(choice) {
    payChoice = payPrices && choice === "cod" ? "cod" : "online";
    var cod = payChoice === "cod";
    els.payChoice.querySelectorAll("input").forEach(function (input) { input.checked = input.value === payChoice; });
    if (payPrices) renderSummaryPrice(cod ? payPrices.cod : payPrices.online, payPrices.mrp);
    // Codes never apply to COD, so the "applied" badge must not show beside it.
    els.summary.querySelectorAll(".pt-addr-summary-offer").forEach(function (el) { el.classList.toggle("pt-hide", cod); });
    els.summaryPay.textContent = cod
      ? "Nothing to pay now. Pay " + inr(payPrices.cod) + " in cash when your order arrives."
      : "No payment is taken on this step. Continue to pay securely using UPI, cards or net banking." +
        (META_INAPP ? " Paying by UPI inside Instagram or Facebook? If your UPI app does not open, tap ⋯ at the top right and choose “Open in browser”." : "");
    els.secureTexts.forEach(function (el) {
      el.textContent = cod ? "Cash on delivery · pay when your order arrives" : "Secured by Razorpay · UPI · Cards · Net Banking";
    });
    renderBreakdown();
    if (guestMode && els.save) els.save.innerHTML = IC.lock + saveLabel();
    // The code send needs a bot score. Minted now, while the buyer is still on
    // the form, so the tap does not wait on Google.
    if (cod && guestMode) primeCaptcha();
  }

  // What the buyer owes under the method they have picked, in paise, or 0
  // when there is no order on screen.
  function payTotal() {
    if (!priced) return 0;
    return payChoice === "cod" && payPrices ? payPrices.cod : priced.amount;
  }

  // The amount rides on the button, so the last thing read before the tap is
  // the number that will be charged (or owed on the doorstep).
  function saveLabel() {
    if (!guestMode) return "Save &amp; continue to pay";
    var total = payTotal();
    return (payChoice === "cod" ? "Place order, pay on delivery" : "Continue to pay") + (total ? " · " + inr(total) : "");
  }

  // What the total is made of, as the list the Stitch checkout shows. The lines
  // are derived from the same two numbers the header already shows (and the
  // fee the caller priced), so they cannot add up to anything else: list price
  // less the discount, plus the fee, is the total, by construction. Text only.
  function renderBreakdown() {
    if (!els || !els.breakdown) return;
    els.breakdown.textContent = "";
    if (!priced) return;
    var cod = payChoice === "cod" && !!payPrices;
    var total = payTotal();
    var net = cod ? total - priced.fee : total;
    var base = Number.isFinite(priced.mrp) && priced.mrp > net ? priced.mrp : net;
    var add = priced.addOn ? priced.addOn.amountPaise : 0;
    var rows = [[priced.name, inr(base - add), ""]];
    if (add) rows.push([priced.addOn.name, "+" + inr(add), ""]);
    if (base > net) rows.push(["Discount", "−" + inr(base - net), "pt-promo"]);
    rows.push(["Delivery", "FREE", "pt-save"]);
    if (cod) rows.push(["Cash on delivery fee", "+" + inr(priced.fee), ""]);
    rows.push([cod ? "To pay on delivery" : "Total to pay", inr(total), "pt-total"]);
    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "pt-addr-bk-row" + (r[2] ? " " + r[2] : "");
      var dt = document.createElement("dt");
      dt.textContent = r[0];
      var dd = document.createElement("dd");
      dd.textContent = r[1];
      row.append(dt, dd);
      els.breakdown.appendChild(row);
    });
  }

  var suggTimer = null, suggSeq = 0, suggList = [];

  function hideSugg() {
    if (els && els.sugg) els.sugg.classList.add("pt-hide");
  }

  function fetchSugg(q) {
    var seq = ++suggSeq;
    var pin = els.inputs.pincode.value;
    fetch("/api/shop/address-suggest?q=" + encodeURIComponent(q) + (pin ? "&pin=" + pin : ""))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (seq !== suggSeq) return; // an older answer arriving late
        suggList = (data && data.suggestions) || [];
        els.sugg.replaceChildren();
        suggList.forEach(function (sg, i) {
          var b = document.createElement("button");
          b.type = "button";
          b.dataset.i = String(i);
          b.textContent = sg.main;
          var small = document.createElement("small");
          small.textContent = sg.secondary;
          b.appendChild(small);
          els.sugg.appendChild(b);
        });
        els.sugg.classList.toggle("pt-hide", !suggList.length || document.activeElement !== els.inputs.line1);
      })
      .catch(hideSugg);
  }

  // Street into line 1; the locality part of the rest into the area line, less
  // what City, State and PIN already hold.
  function pickSugg(sg) {
    if (!sg) return;
    els.inputs.line1.value = sg.main;
    var drop = [els.inputs.city.value, els.inputs.state.value, "India"].map(function (x) { return String(x).toLowerCase(); });
    var area = String(sg.secondary || "").split(",").map(function (x) { return x.trim(); }).filter(function (x) {
      return x && !/[0-9]{6}/.test(x) && drop.indexOf(x.toLowerCase()) < 0 && STATES.indexOf(x) < 0;
    }).slice(0, 3).join(", ");
    if (!els.inputs.line2.value && area) els.inputs.line2.value = area;
    if (!els.inputs.pincode.value && sg.pincode) {
      els.inputs.pincode.value = sg.pincode;
      lookupPin(sg.pincode);
    }
    draftKeep();
    hideSugg();
    if (typeof window.clarity === "function") window.clarity("event", "address_suggestion_used");
  }

  // India Post's state for the last pincode looked up, so validate() can catch
  // a pincode from another state before the buyer pays.
  var pinState = null;

  // Best effort: fills City and State from India Post's public PIN lookup, and
  // only into boxes the buyer left empty. A slow or failed lookup changes
  // nothing, and the buyer types them as before.
  function lookupPin(pin) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 4000) : null;
    fetch("https://api.postalpincode.in/pincode/" + pin, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        var office = data && data[0] && data[0].Status === "Success" && data[0].PostOffice && data[0].PostOffice[0];
        if (!office || els.inputs.pincode.value !== pin) return;
        if (!els.inputs.city.value && office.District) els.inputs.city.value = office.District;
        var state = STATES.filter(function (st) { return st.toLowerCase() === String(office.State || "").toLowerCase(); })[0];
        if (state) pinState = { pin: pin, state: state };
        if (!els.inputs.state.value && state) els.inputs.state.value = state;
        draftKeep();
      })
      .catch(function () { /* typed by hand instead */ })
      .then(function () { if (timer) clearTimeout(timer); });
  }

  function validate(v) {
    if (!v.fullName || v.fullName.length < 2) return "Please enter the recipient's full name.";
    if (!/^[6-9][0-9]{9}$/.test(v.phone)) return "Enter a valid 10-digit mobile number.";
    if (!v.line1 || v.line1.length < 4) return "Enter your house / flat and street.";
    if (!v.city || v.city.length < 2) return "Please enter your city.";
    if (!v.state || v.state.length < 2) return "Please enter your state.";
    if (!/^[1-9][0-9]{5}$/.test(v.pincode)) return "Enter a valid 6-digit pincode (your area's postal code).";
    if (pinState && pinState.pin === v.pincode && pinState.state !== v.state) {
      return "That pincode is in " + pinState.state + ", not " + v.state + ". Please check your area's postal code.";
    }
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
    if (addr.pincode) region = (region ? region + ", " : "") + addr.pincode;
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
    reveal(els.confirm);
  }

  // Show the editable form, optionally prefilled with an existing address.
  function showForm(prefill) {
    clearErr();
    trackedFields = {};
    FIELDS.forEach(function (f) {
      els.inputs[f.key].value = prefill && prefill[f.key] != null ? prefill[f.key] : "";
    });
    // A saved address from before the landmark box was folded in keeps it.
    if (prefill && prefill.landmark) {
      els.inputs.line2.value = [els.inputs.line2.value, prefill.landmark].filter(Boolean).join(", ");
    }
    // First-time buyers have no address to prefill from, but many do have a
    // name on their profile by now. Filling it saves them retyping what we
    // already know, and it stays editable — plenty of people ship to someone
    // else. Only ever fills a blank; a saved address always wins.
    if (!els.inputs.fullName.value && profileName) {
      els.inputs.fullName.value = profileName;
    }
    // What was typed here before a reload wins over all of the above: it is the
    // newest thing the buyer told us. Only what they actually typed; a box they
    // left empty keeps its prefill.
    var draft = draftRead();
    if (draft) {
      FIELDS.forEach(function (f) {
        var typed = draft.fields[f.key];
        if (typeof typed === "string" && typed) els.inputs[f.key].value = typed;
      });
      // Only ever restored as OFF. A buyer who unticked the WhatsApp box must
      // not find it ticked again because they reloaded.
      if (draft.optIn === false && els.optIn) els.optIn.checked = false;
    }
    // Two lines of copy that are only true when there is an account behind the
    // sheet. A guest is not saving anything to a profile, and telling them so
    // would be the sheet promising something the page cannot do.
    if (els.note) {
      els.note.textContent = guestMode
        ? "Used for this delivery. Your tag is activated after it arrives."
        : "Saved to your profile. You won't need to enter it again.";
    }
    if (els.save) els.save.innerHTML = IC.lock + saveLabel();

    els.title.textContent = prefill ? "Edit delivery address" : priced ? "Complete your order" : "Delivery address";
    els.sub.textContent = prefill
      ? "Update where we should ship your sticker."
      : priced
        ? "Your mobile number, how you will pay, and where it goes."
        : "Where should we ship your official ParkTag sticker?";
    els.confirm.classList.add("pt-hide");
    els.otp.classList.add("pt-hide");
    clearInterval(resendTimer);
    els.form.classList.remove("pt-hide");
    reveal(els.form);
  }

  // COD only: a parcel to an address the courier cannot find comes back, and
  // ParkTag pays both ways. Ola checks street, city and PIN agree; on a
  // mismatch the buyer is told once, on the code screen, and may still place
  // it by entering the code. A lookup that fails or times out never stops the
  // order. One verdict per address, so going back and forth does not ask twice.
  var addrVerdicts = {};
  var addrWarned = {};
  function addressLooksWrong(v) {
    var key = JSON.stringify(v);
    if (!addrVerdicts[key]) {
      addrVerdicts[key] = fetch("/api/shop/address-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: v })
      })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) { return data ? data.validated : null; })
        .catch(function () { return null; }); // unknown: carry on
    }
    return addrVerdicts[key].then(function (validated) { return validated === false; });
  }

  async function onSave() {
    clearErr();
    var v = readForm();
    var problem = validate(v);
    if (problem) { showErr(problem); return; }

    // No account to save it to: hand the address straight back to the caller,
    // which sends it with the order.
    if (guestMode) {
      if (payPrices && payChoice === "cod") {
        startCodCheck(v);
        return;
      }
      // `source` tells a deliberate tick apart from the default state later,
      // which is the difference that matters if consent is ever questioned.
      var ticked = !!(els.optIn && els.optIn.checked);
      var consent = { marketingOptIn: ticked, marketingOptInSource: ticked && els.optIn.defaultChecked ? "checkout-default" : "checkout-ticked" };
      close(payPrices ? Object.assign({}, v, { paymentMethod: payChoice }, consent) : Object.assign({}, v, consent));
      return;
    }

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
      draftClear(); // it is on the profile now
      close(true);
    } catch (e) {
      showErr(e.message || "Could not save address. Please try again.");
    } finally {
      els.save.disabled = false;
      els.save.innerHTML = label;
    }
  }

  // ── Guest Cash on Delivery: prove the mobile before resolving ──

  // A bot-check token for the code send, minted ahead of the tap (see
  // setPayChoice and warmIfComplete) and used while it is young enough for
  // Google. A token is good once, so it is taken, never reused.
  var CAPTCHA_FRESH_MS = 90 * 1000;
  var primedCaptcha = null; // { at, token: Promise<string> }
  function mintCaptcha() {
    try { return Promise.resolve(captchaFn ? captchaFn() : "").then(function (t) { return t || ""; }, function () { return ""; }); }
    catch (_) { return Promise.resolve(""); }
  }
  function primeCaptcha() {
    if (!captchaFn || !guestMode) return;
    if (primedCaptcha && Date.now() - primedCaptcha.at < CAPTCHA_FRESH_MS) return;
    primedCaptcha = { at: Date.now(), token: mintCaptcha() };
  }
  async function takeCaptcha() {
    var kept = primedCaptcha;
    primedCaptcha = null;
    var token = kept && Date.now() - kept.at < CAPTCHA_FRESH_MS ? await kept.token : "";
    return token || mintCaptcha();
  }

  async function sendCodCode(phone, pincode) {
    var recaptchaToken = await takeCaptcha();
    var res = await fetch("/api/shop/guest/cod-otp/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: phone, pincode: pincode, recaptchaToken: recaptchaToken })
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not send the code. Please try again.");
  }

  // The tap on "Place order, pay on delivery".
  //
  // This used to wait: the address was checked with Ola, then a bot-check
  // token minted, then the code sent, and only then did the code screen
  // appear, two seconds and more after the tap. None of that needs the buyer
  // to watch it. The code screen is shown at once, saying the code is on its
  // way; the send runs behind it (and a failure brings the form back with
  // the reason, exactly where it would have appeared before); and the address
  // verdict, asked for at the same moment, lands on the screen as a note if
  // it is a mismatch. The code itself takes a few seconds to reach WhatsApp,
  // which is longer than any of this.
  //
  // `codSeq` ties each answer to the tap that asked: a buyer who went back,
  // or whose sheet was closed, is not shown a stale one.
  var codSeq = 0;
  function startCodCheck(v) {
    codSeq += 1;
    var seq = codSeq;
    codAddress = v;
    showOtp();
    var onCodeScreen = function () { return seq === codSeq && els.otp && !els.otp.classList.contains("pt-hide"); };

    sendCodCode(v.phone, v.pincode).then(function () {
      if (!onCodeScreen()) return;
      els.sub.textContent = "We sent a 6-digit code on WhatsApp to " + v.phone +
        ". Enter it to place your Cash on Delivery order.";
      startResendTimer();
    }, function (e) {
      if (!onCodeScreen()) return;
      showForm(v);
      showErr(e.message || "Could not send the code. Please try again.");
    });

    addressLooksWrong(v).then(function (wrong) {
      if (!wrong || !onCodeScreen()) return;
      els.otpNote.textContent = "We couldn't match this address to PIN " + v.pincode +
        ". Go back to check the PIN and street, or enter the code to place the order anyway.";
      els.otpNote.classList.add("pt-show");
      var key = JSON.stringify(v);
      if (!addrWarned[key] && typeof window.clarity === "function") window.clarity("event", "cod_address_mismatch");
      addrWarned[key] = true;
    });
  }

  function showOtpErr(msg) {
    els.otpErr.textContent = msg;
    els.otpErr.classList.add("pt-show");
    els.code.setAttribute("aria-invalid", "true");
  }
  function clearOtpErr() {
    els.otpErr.textContent = "";
    els.otpErr.classList.remove("pt-show");
    els.code.removeAttribute("aria-invalid");
  }

  function showOtp() {
    clearOtpErr();
    els.otpNote.textContent = "";
    els.otpNote.classList.remove("pt-show");
    els.code.value = "";
    els.title.textContent = "Confirm your mobile";
    els.sub.textContent = "Sending a 6-digit code on WhatsApp to " + codAddress.phone +
      "\u2026 Enter it to place your Cash on Delivery order.";
    els.form.classList.add("pt-hide");
    els.otp.classList.remove("pt-hide");
    reveal(els.otp);
    // Resend opens once the first send has landed (see startCodCheck).
    clearInterval(resendTimer);
    els.resend.disabled = true;
    els.resend.textContent = "Sending code\u2026";
    els.code.focus();
  }

  function startResendTimer() {
    var left = RESEND_SECONDS;
    clearInterval(resendTimer);
    els.resend.disabled = true;
    els.resend.textContent = "Resend code in " + left + "s";
    resendTimer = setInterval(function () {
      left -= 1;
      if (left > 0) { els.resend.textContent = "Resend code in " + left + "s"; return; }
      clearInterval(resendTimer);
      els.resend.disabled = false;
      els.resend.textContent = "Resend code";
    }, 1000);
  }

  async function onResend() {
    clearOtpErr();
    els.resend.disabled = true;
    els.resend.textContent = "Sending…";
    try {
      await sendCodCode(codAddress.phone, codAddress.pincode);
      startResendTimer();
      els.code.focus();
    } catch (e) {
      showOtpErr(e.message || "Could not send the code. Please try again.");
      els.resend.disabled = false;
      els.resend.textContent = "Resend code";
    }
  }

  async function onVerify() {
    clearOtpErr();
    var code = els.code.value.trim();
    if (!/^[0-9]{6}$/.test(code)) { showOtpErr("Enter the 6-digit code."); els.code.focus(); return; }
    els.verify.disabled = true;
    var label = els.verify.innerHTML;
    els.verify.textContent = "Verifying…";
    try {
      var res = await fetch("/api/shop/guest/cod-otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: codAddress.phone, otp: code })
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok || !data.codToken) throw new Error(data.error || "Could not check the code. Please try again.");
      clearInterval(resendTimer);
      close(Object.assign({}, codAddress, { paymentMethod: "cod", codToken: data.codToken }));
    } catch (e) {
      showOtpErr(e.message || "Could not check the code. Please try again.");
      els.code.select();
    } finally {
      els.verify.disabled = false;
      els.verify.innerHTML = label;
    }
  }

  // `saved` is `true` for the signed-in flow and the address object in guest
  // mode. Passed through rather than coerced, because the guest caller needs
  // the values — and an object is truthy, so `if (!await ptCollectAddress())`
  // still reads the same at every existing call site.
  function close(saved) {
    clearInterval(resendTimer);
    if (guestMode && !saved && typeof window.clarity === "function") {
      window.clarity("event", "checkout_dismissed");
    }
    // A signed-in owner who backs out has abandoned whatever they were typing:
    // their saved address stands, and the next open must show it, not a
    // half-made edit. (A reload never comes through here, so it keeps the
    // draft.) A guest's draft is kept either way: they have no saved address
    // to fall back on, and backing out to pick another pack is ordinary.
    if (!guestMode && !saved) draftClear();
    dismiss();
    // Closed by Deliver, Cancel, the backdrop or Escape: take the sheet's
    // history entry with it, or the next back press would be a dud.
    if (historyEntry) {
      historyEntry = false;
      try { window.history.back(); } catch (_) { /* nothing to undo */ }
    }
    var r = resolver;
    resolver = null;
    // When an extra was offered, the answer to it travels with the address.
    if (saved && typeof saved === "object" && addOnOffer) saved = Object.assign({}, saved, { addOn: addOnOn });
    if (r) r(saved === true ? true : (saved || false));
  }

  // Play the exit, then take the sheet off screen. The promise resolves without
  // waiting for it — the caller opens Razorpay next, and no payment window
  // should be held back by a fade.
  var closeTimer = null;
  function dismiss() {
    if (!els || !els.ov.classList.contains("pt-open")) return;
    els.ov.classList.add("pt-closing");
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () {
      // Reopened while it was fading: the open path clears pt-closing, and
      // pulling pt-open now would hide a sheet that is on its way back in.
      if (!els.ov.classList.contains("pt-closing")) return;
      els.ov.classList.remove("pt-closing");
      els.ov.classList.remove("pt-open");
      els.sheet.classList.remove("pt-in");
    }, 220);
  }

  // Fetch the saved address (if any) to decide which view to show.
  async function fetchSaved() {
    try {
      var res = await fetch("/api/owner/address");
      if (!res.ok) return null;
      var data = await res.json();
      return data && data.address ? data.address : null;
    } catch (_) {
      return null; // network hiccup, fall back to the form
    }
  }

  // The name already on the profile, used only to prefill a blank recipient
  // field. Best-effort: if this fails the form simply opens empty, exactly as
  // it did before, so the address flow never depends on it.
  async function fetchProfileName() {
    try {
      var res = await fetch("/api/owner/dashboard?qr=0");
      if (!res.ok) return "";
      var data = await res.json();
      return (data && data.owner && data.owner.displayName) || "";
    } catch (_) {
      return "";
    }
  }

  // Restart the entrance on the sheet (re-add the class after a reflow).
  function popIn() {
    els.sheet.classList.remove("pt-in");
    void els.sheet.offsetWidth; // force reflow so the animation replays
    els.sheet.classList.add("pt-in");
  }

  // The same trick for one element: used on the view being shown, so the
  // confirm -> edit swap moves as well, not only the initial open.
  function reveal(el) {
    if (!el) return;
    el.classList.remove("pt-reveal");
    void el.offsetWidth;
    el.classList.add("pt-reveal");
  }

  // Public API. Resolves once the address is confirmed or saved, false if
  // dismissed — `true` for a signed-in owner, and the address object itself
  // when called as ptCollectAddress({ guest: true }) from the public
  // storefront, which has no profile to save it to.
  window.ptCollectAddress = function (options) {
    guestMode = !!(options && options.guest);
    orderSummary = options && options.orderSummary ? options.orderSummary : null;
    captchaFn = options && typeof options.captchaToken === "function" ? options.captchaToken : null;
    codAddress = null;
    codSeq += 1; // an answer still in flight from the last open is nobody's now
    primedCaptcha = null;
    if (!els) build();
    // No summary means no priced COD: a stale choice must not carry over.
    payPrices = null;
    addOnOffer = orderSummary && orderSummary.addOn && typeof orderSummary.addOn === "object" ? orderSummary.addOn : null;
    addOnOn = !!(addOnOffer && addOnOffer.checked);
    showOrderSummary(currentSummary());
    showAddOnCard();
    return new Promise(function (resolve) {
      // If a sheet is somehow already open, cancel the previous waiter.
      if (resolver) resolver(false);
      resolver = resolve;
      // Fetch first, then reveal the populated sheet with a pop — so it never
      // pops in empty and then fills. The fetch is quick; the backdrop fades
      // meanwhile via the overlay's own transition.
      els.confirm.classList.add("pt-hide");
      els.form.classList.add("pt-hide");
      els.otp.classList.add("pt-hide");
      clearInterval(resendTimer);
      els.sheet.classList.remove("pt-in");
      // Reopened mid-fade: drop the exit and cancel the timer that would
      // otherwise hide the overlay a moment from now.
      clearTimeout(closeTimer);
      els.ov.classList.remove("pt-closing");
      els.ov.classList.add("pt-open");
      // After a reload the entry this sheet added is still the current one, so
      // it is adopted, not added to: a second push would make the back button
      // need two presses to leave.
      if (!historyEntry) {
        try {
          if (window.history.state && window.history.state.ptAddressSheet) {
            historyEntry = true;
          } else {
            window.history.pushState({ ptAddressSheet: true }, "");
            historyEntry = true;
          }
        } catch (_) { /* no history to speak of: back leaves the page, as before */ }
      }
      // A guest has no saved address and no profile, so both lookups would be
      // two guaranteed 401s and a slower sheet. Straight to the blank form.
      if (guestMode) {
        savedAddress = null;
        profileName = "";
        showForm(null);
        // Cash on Delivery, if it was chosen before a reload and this open
        // still offers it. setPayChoice re-prices the total and the button.
        var kept = draftRead();
        if (kept && kept.pay === "cod" && payPrices) setPayChoice("cod");
        // An address restored after a reload may already be complete.
        warmIfComplete();
        if (typeof window.clarity === "function") {
          window.clarity("event", "address_started");
        }
        popIn();
        return;
      }

      // Both requests go out together: the profile name is only needed for the
      // blank-form case, and waiting for it in series would delay the sheet for
      // everyone who already has an address saved.
      Promise.all([fetchSaved(), fetchProfileName()]).then(function (results) {
        var addr = results[0];
        profileName = results[1] || "";
        savedAddress = addr;
        // A draft in owner mode means the page was reloaded while the form was
        // being filled in (backing out clears it), so go back to the form with
        // what was typed, not to the confirm card.
        if (addr && !draftRead()) showConfirm(addr);
        else showForm(addr);
        popIn();
      });
    });
  };
  // For the pages: forget the typed address once the order is placed or paid.
  window.ptCollectAddress.clearDraft = draftClear;
})();
