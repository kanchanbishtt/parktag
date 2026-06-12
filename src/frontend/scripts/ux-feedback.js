// Global UX feedback: top progress bar + button loading states

(function () {
  // Inject progress bar element
  const bar = document.createElement("div");
  bar.id = "pt-progress-bar";
  document.body.prepend(bar);

  let timer = null;
  let width = 0;

  function startProgress() {
    bar.style.opacity = "1";
    bar.classList.remove("pt-bar-done");
    width = 0;
    bar.style.width = "0%";

    clearInterval(timer);
    timer = setInterval(() => {
      // Ease toward 85% — never completes on its own
      const remaining = 85 - width;
      width += remaining * 0.08;
      bar.style.width = width + "%";
    }, 60);
  }

  function finishProgress() {
    clearInterval(timer);
    bar.style.width = "100%";
    setTimeout(() => {
      bar.classList.add("pt-bar-done");
      setTimeout(() => {
        bar.style.width = "0%";
        bar.style.opacity = "1";
        bar.classList.remove("pt-bar-done");
        width = 0;
      }, 450);
    }, 200);
  }

  // Expose globally so individual scripts can call them
  window.ptProgress = { start: startProgress, finish: finishProgress };

  // Auto-wire all pt-btn and .action buttons on click
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button.pt-btn, button.action, a.pt-btn");
    if (!btn || btn.disabled) return;

    // Don't start for purely navigation links with no async work
    if (btn.tagName === "A" && !btn.classList.contains("pt-async")) {
      startProgress();
      // Nav links finish on page load
      return;
    }

    // For buttons, start bar — the handler must call ptProgress.finish()
    // or it auto-finishes after 6s as a fallback
    startProgress();
    const fallback = setTimeout(() => finishProgress(), 6000);
    btn._ptFallback = fallback;
  });

  // Finish on DOM content load (covers page navigations)
  window.addEventListener("load", () => finishProgress());
})();
