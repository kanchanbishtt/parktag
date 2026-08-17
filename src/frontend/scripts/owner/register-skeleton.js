// Swaps the loading skeleton for the real form shortly after load.
//
// Lives in a file rather than in a <script> block on the page so that
// /register-owner can be served with a script-src that has no 'unsafe-inline'
// (see STRICT_SCRIPT_PAGES in src/backend/app.js).
//
// Each lookup is guarded. The inline version assumed all three elements were
// present and would throw on the first missing one, leaving the skeleton up for
// good — with `defer` this now runs against a parsed document, but a markup
// change should degrade to "reveals the form" rather than "page never loads".
setTimeout(function revealPage() {
  const skeleton = document.getElementById("page-skeleton");
  const content = document.getElementById("page-content");
  const submitBar = document.querySelector(".av-submit-bar");

  if (skeleton) skeleton.style.display = "none";
  if (submitBar) submitBar.style.display = "block";
  if (content) {
    requestAnimationFrame(() => content.classList.add("sk-visible"));
  }
}, 250);
