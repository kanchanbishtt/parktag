// Makes the owner pages installable.
//
// Two jobs. First, register the service worker (/sw.js), which gives the app
// its offline page and is one of the things a browser needs before it offers
// "Install". Second, on the dashboard, turn the browser's install offer into a
// row in the menu drawer (#menuInstallRow), so an owner finds it where the
// other settings are instead of in a bar the browser shows once and hides.
//
// On a page without that row (sign-in, register) the browser's own install
// offer is left alone: the event is not cancelled, so Chrome keeps showing
// its usual icon or bar. Safari on iPhone never fires the event (there the
// owner installs from Share, "Add to Home Screen"), so the row stays hidden
// and nothing on the page changes.
//
// A classic script, not a module, so the strict sign-in pages can load it as
// a plain file. Nothing here is required for the page to work: if anything
// throws, the dashboard is exactly as it was without this file.
(function () {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      // A failed registration costs the offline page and nothing else.
    });
  });

  var pending = null;

  function installRow() {
    return document.getElementById("menuInstallRow");
  }

  function alreadyInstalled() {
    return (
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true
    );
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    var row = installRow();
    if (!row || alreadyInstalled()) return;
    event.preventDefault();
    pending = event;
    row.style.display = "";
  });

  window.addEventListener("appinstalled", function () {
    pending = null;
    var row = installRow();
    if (row) row.style.display = "none";
  });

  // Wired to the drawer row's onclick in welcome.html.
  window.ptInstallApp = function () {
    var prompt = pending;
    pending = null;
    var row = installRow();
    if (row) row.style.display = "none";
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.catch(function () {});
  };
})();
