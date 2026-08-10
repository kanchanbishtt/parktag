// Slide-out menu for the scan page. Kept out of app.js: nothing here touches
// the contact flow, and the drawer has to keep working even if the scan itself
// fails to load.

const drawer = document.getElementById("pt-nav");
const scrim = document.getElementById("pt-nav-scrim");
const openButton = document.getElementById("pt-nav-open");
const closeButton = document.getElementById("pt-nav-close");

// The markup is optional — bail rather than throw if the page ever drops it.
if (drawer && scrim && openButton && closeButton) {

  // Focus returns here on close, so a keyboard user lands back where they were.
  let lastFocused = null;

  // The open menu gets its own history entry. Two things fall out of that: the
  // Android back gesture closes the menu instead of leaving the page, and
  // following a link out of the menu then pressing Back returns to the OPEN
  // menu rather than the scan card behind it.
  //
  // The entry's state is what carries the menu across that round trip, not a
  // restored DOM — this page is served `no-store`, which disables bfcache, so
  // coming back is always a fresh load.
  const NAV_STATE = "ptNavOpen";
  const isNavEntry = () => Boolean(history.state && history.state[NAV_STATE]);

  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusableItems() {
    return Array.from(drawer.querySelectorAll(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === closeButton
    );
  }

  function isOpen() {
    return drawer.classList.contains("is-open");
  }

  function openMenu({ restoring = false } = {}) {
    if (isOpen()) return;
    lastFocused = document.activeElement;
    // `inert` is what actually keeps the links out of the tab order and off the
    // accessibility tree while the drawer sits off-screen; the class only moves it.
    drawer.removeAttribute("inert");
    drawer.classList.add("is-open");
    scrim.classList.add("is-open");
    document.body.classList.add("pt-nav-open");
    openButton.setAttribute("aria-expanded", "true");
    closeButton.focus();
    // Restoring means we are already standing on the menu's entry; pushing
    // again would stack a second one and take two Backs to escape.
    if (!restoring) {
      history.pushState({ [NAV_STATE]: true, tab: selectedTabId() }, "");
    }
  }

  function closeMenu({ fromHistory = false } = {}) {
    if (!isOpen()) return;
    drawer.classList.remove("is-open");
    scrim.classList.remove("is-open");
    document.body.classList.remove("pt-nav-open");
    openButton.setAttribute("aria-expanded", "false");
    // Move focus out before `inert` lands on the element holding it, or the
    // browser drops focus to <body> and the tab order restarts from the top.
    // <body> is not a focusable target, so anything that isn't a real element
    // to return to falls back to the burger the menu was opened from.
    const returnTo =
      lastFocused && lastFocused !== document.body && document.contains(lastFocused)
        ? lastFocused
        : openButton;
    returnTo.focus();
    drawer.setAttribute("inert", "");
    // Drop the entry we pushed, or a later Back would walk into the menu the
    // visitor has already dismissed. Skipped when history is what closed us —
    // by then the entry is gone already.
    if (!fromHistory && isNavEntry()) history.back();
  }

  openButton.addEventListener("click", () => openMenu());
  closeButton.addEventListener("click", () => closeMenu());
  scrim.addEventListener("click", () => closeMenu());

  // Back/forward: the entry decides. Landing on the menu's entry opens it,
  // stepping off it closes it.
  window.addEventListener("popstate", () => {
    if (isNavEntry()) openMenu({ restoring: true });
    else closeMenu({ fromHistory: true });
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key !== "Tab") return;

    // Keep Tab inside the drawer while it is the only thing on screen.
    const items = focusableItems();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // ── Utility / Business / More ──────────────────────────────────────────
  const tabs = Array.from(drawer.querySelectorAll(".pt-nav-tab"));

  function selectedTabId() {
    const current = tabs.find((t) => t.getAttribute("aria-selected") === "true");
    return current ? current.id : null;
  }

  function selectTab(tab) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
    }
    // Remember which section is showing, so coming back from a link opens the
    // menu on the tab it was followed from rather than resetting to Utility.
    if (isNavEntry()) {
      history.replaceState({ ...history.state, tab: tab.id }, "");
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));

    // Arrow keys move between tabs, as a tablist is expected to.
    tab.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      selectTab(next);
      next.focus();
    });
  });

  // Arriving on the menu's own history entry — the visitor followed a link out
  // and came back. Put the menu back the way they left it, on the same tab.
  if (isNavEntry()) {
    const previous = history.state.tab && document.getElementById(history.state.tab);
    if (previous) selectTab(previous);
    openMenu({ restoring: true });
  }
}
