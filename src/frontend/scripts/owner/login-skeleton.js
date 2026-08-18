// Reveals the page and fades out the loading skeleton once the DOM is ready.
//
// Lives in a file rather than in a <script> block on the page so that
// /owner-login can be served with a script-src that has no 'unsafe-inline'
// (see STRICT_SCRIPT_PAGES in src/backend/app.js). Loaded with `defer`, so it
// still runs at DOMContentLoaded exactly as the inline version did.
document.addEventListener("DOMContentLoaded", () => {
  document.body.style.opacity = "1";

  const skeleton = document.getElementById("login-skeleton");
  if (!skeleton) return;

  skeleton.classList.add("fade-out");
  setTimeout(() => skeleton.remove(), 200);
});
