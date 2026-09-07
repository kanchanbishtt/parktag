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


  // ── Named, determinate step progress ─────────────────────────────────────
  //
  // The bar above is one thin line at the top of the viewport that eases to 85%
  // and never arrives. On a phone it sits under the browser chrome against a
  // navy header, so in practice nobody has ever seen it, and what it reports is
  // not true anyway.
  //
  // This is the other kind: mounted INSIDE the card the person is looking at,
  // filled from work that has actually completed, and labelled with what is
  // happening right now. It exists because the flows it serves are two and
  // three server round trips long, several seconds end to end, and a silent
  // spinner over that length reads as a stall rather than as work.
  //
  // THE ONE RULE. A segment advances only when its real await resolves. Inside
  // a segment the fill eases toward that segment's ceiling so the bar is never
  // frozen, but it cannot cross a boundary the server has not reached. Naming
  // finer-grained work than the round trips is fine and is the point; claiming
  // work is finished before it is, is not.
  function makeSteps(mount, steps) {
    if (!mount || !Array.isArray(steps) || !steps.length) return inertRun();

    const total = steps.reduce((sum, s) => sum + (s.weight || 1), 0);
    const reduced = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    const root = document.createElement("div");
    root.className = "pt-steps";
    root.innerHTML =
      '<div class="pt-steps-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<span class="pt-steps-fill"></span></div>' +
      '<p class="pt-steps-label" aria-live="polite"></p>';

    const fill = root.querySelector(".pt-steps-fill");
    const track = root.querySelector(".pt-steps-track");
    const label = root.querySelector(".pt-steps-label");

    mount.replaceChildren(root);

    let index = -1;
    let done = 0;          // weight completed, as a fraction of total
    let shown = 0;         // what the bar is currently displaying
    let timer = null;
    let finished = false;

    function ceilingFor(i) {
      const upto = steps.slice(0, i + 1).reduce((sum, s) => sum + (s.weight || 1), 0);
      return upto / total;
    }

    function paint(value) {
      shown = value;
      fill.style.width = `${Math.round(value * 100)}%`;
      track.setAttribute("aria-valuenow", String(Math.round(value * 100)));
    }

    // Ease toward the CURRENT segment's ceiling, never past it. The gap closes
    // by a fixed fraction each tick, so it decelerates and visibly never
    // arrives, which is the honest shape: the step is not done yet.
    function tick() {
      const ceiling = ceilingFor(index);
      const room = ceiling - shown;
      if (room <= 0.001) return;
      paint(shown + room * 0.06);
    }

    function enter(i) {
      index = i;
      const step = steps[i];
      if (!step) return;
      label.textContent = step.label;
      if (!reduced && timer === null) timer = setInterval(tick, 90);
      if (reduced) paint(done);
    }

    return {
      begin() {
        if (finished) return;
        paint(0);
        enter(0);
      },
      // One real step finished. Snap to its boundary, then start easing into
      // the next: the jump is the honest part, the ease is the waiting.
      advance() {
        if (finished || index < 0) return;
        done = ceilingFor(index);
        paint(done);
        if (index + 1 < steps.length) enter(index + 1);
      },
      // Escalation from requestJson's onSlow, so a slow connection reads as
      // slow rather than as broken. Never touches the fill.
      slow(message) {
        if (finished) return;
        label.textContent = message;
      },
      done() {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        timer = null;
        paint(1);
        root.classList.add("pt-steps-ok");
      },
      // Stops exactly where it got to. A bar that snaps to full and THEN says
      // it failed has told two contradictory stories in one second.
      fail(message) {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        timer = null;
        root.classList.add("pt-steps-bad");
        if (message) label.textContent = message;
      },
      destroy() {
        clearInterval(timer);
        timer = null;
        if (root.parentNode) root.remove();
      }
    };
  }

  // Returned when there is nothing to mount into. Every method is a no-op, so a
  // caller never has to null-check and a missing element can never take down
  // the request it was decorating.
  function inertRun() {
    const noop = () => {};
    return { begin: noop, advance: noop, slow: noop, done: noop, fail: noop, destroy: noop };
  }

  // One progress concept in the app, not two rival ones.
  window.ptProgress = { start: startProgress, finish: finishProgress, steps: makeSteps };

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

    // A button that owns a step run reports its own progress inside the card.
    // Starting the top bar as well would put two indicators on screen telling
    // slightly different stories.
    if (btn.closest("[data-pt-owns-progress]")) return;

    // For buttons, start bar. The handler must call ptProgress.finish()
    // or it auto-finishes after 6s as a fallback
    startProgress();
    const fallback = setTimeout(() => finishProgress(), 6000);
    btn._ptFallback = fallback;
  });

  // Finish on DOM content load (covers page navigations)
  window.addEventListener("load", () => finishProgress());
})();
