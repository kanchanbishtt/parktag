// The admin sidebar on the pages that run their own script instead of
// index.js (Tags, Activations, Field Demo, Traffic, Promo Codes, Reviews).
// index.js wires the same sidebar on the other admin pages; its Refresh
// reloads that page's data through loaders these pages do not have, so here
// Refresh reloads the page.
//
// Wrapped in a function: these pages load classic scripts that share one
// global scope, and their own top-level names (list, esc, ...) must not clash.
(() => {
  const shell = document.querySelector(".pt-admin-shell");
  const sidebar = shell?.querySelector(".pt-admin-sidebar");
  const main = shell?.querySelector(".pt-admin-main");
  if (!shell || !sidebar || !main) return;

  document.getElementById("admin-refresh-button")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Refreshing…";
    window.location.reload();
  });

  const logout = document.getElementById("admin-logout-button");
  logout?.addEventListener("click", async () => {
    logout.disabled = true;
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // replace(), not href: the admin console the user just left must not be
      // one Back press away, on a shared machine least of all.
      window.location.replace("/admin");
    } catch {
      logout.disabled = false;
      logout.textContent = "Couldn't sign out";
      setTimeout(() => { logout.textContent = "Sign out"; }, 3000);
    }
  });

  // Phone-width menu, as in index.js: below 760px the CSS parks the sidebar
  // off-screen and this adds the button that slides it in. Every page starts
  // with it closed, including one restored by the back button.
  if (!sidebar.id) sidebar.id = "pt-admin-sidebar";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pt-admin-menu-btn";
  button.setAttribute("aria-controls", sidebar.id);
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Menu`;
  main.prepend(button);

  const backdrop = document.createElement("div");
  backdrop.className = "pt-admin-backdrop";
  shell.append(backdrop);

  const setOpen = (open) => {
    shell.classList.toggle("is-menu-open", open);
    button.setAttribute("aria-expanded", String(open));
    if (open) sidebar.querySelector(".pt-admin-nav-item.is-active, .pt-admin-nav-item")?.focus();
  };

  button.addEventListener("click", () => setOpen(!shell.classList.contains("is-menu-open")));
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shell.classList.contains("is-menu-open")) {
      setOpen(false);
      button.focus();
    }
  });
  window.addEventListener("pageshow", () => setOpen(false));
})();
