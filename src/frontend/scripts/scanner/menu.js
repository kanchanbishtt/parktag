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

  function openMenu() {
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
  }

  function closeMenu() {
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
  }

  openButton.addEventListener("click", openMenu);
  closeButton.addEventListener("click", closeMenu);
  scrim.addEventListener("click", closeMenu);

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

  function selectTab(tab) {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(other.getAttribute("aria-controls"));
      if (panel) panel.hidden = !selected;
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
}
