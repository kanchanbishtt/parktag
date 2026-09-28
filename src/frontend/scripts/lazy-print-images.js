// The E-Tag print sheet lives in the page as a hidden block. Browsers still fetch
// the images of a display:none block, so its 135 KB sticker artwork and a
// third-party QR placeholder were paid for on every page load by people who
// never print. The markup now carries data-src instead, and this promotes it
// to src only when a print is about to happen.
//
// An <img> whose src attribute was already set (the real tag QR, put there by the
// page script) is left alone; only a missing src attribute is filled in.
(function () {
  const TIMEOUT_MS = 4000;

  function promote() {
    const loads = [];
    document.querySelectorAll("img[data-src]").forEach((img) => {
      if (!img.hasAttribute("src")) img.src = img.dataset.src;
      if (img.complete) return;
      loads.push(new Promise((resolve) => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      }));
    });
    return Promise.all(loads);
  }

  // Resolves once the print images have loaded, or after a few seconds so a slow
  // network can never keep the print dialog from opening.
  window.ptLoadPrintImages = function () {
    return Promise.race([
      promote(),
      new Promise((resolve) => setTimeout(resolve, TIMEOUT_MS))
    ]);
  };

  // Safety net for Ctrl+P and any print path that does not call the helper.
  window.addEventListener("beforeprint", promote);
})();
