// Numbered pages for admin tag lists (Tags page, Activations → Activated).
// The server sends { page, pages }; this draws  ‹ Prev  1 … 4 5 6 … 30  Next ›
// and calls go(n) when one is picked. Loaded before the page's own script.
(function () {
  // Which numbers to show: always the first and last, and the current page with
  // one either side; a gap stands for everything skipped. Near either end the
  // window widens so the row stays the same length.
  function pageNumbers(page, pages) {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    let from = Math.max(2, page - 1);
    let to = Math.min(pages - 1, page + 1);
    if (page <= 3) { from = 2; to = 5; }
    if (page >= pages - 2) { from = pages - 4; to = pages - 1; }
    const out = [1];
    if (from > 2) out.push("gap");
    for (let n = from; n <= to; n++) out.push(n);
    if (to < pages - 1) out.push("gap");
    out.push(pages);
    return out;
  }

  window.renderPager = function renderPager(el, { page, pages }, go) {
    page = Number(page) || 1;
    pages = Number(pages) || 1;
    if (pages <= 1) {
      el.hidden = true;
      el.innerHTML = "";
      el.onclick = null;
      return;
    }
    const btn = (n, label, extra = "") =>
      `<button type="button" data-page="${n}" ${extra}>${label}</button>`;
    const parts = [btn(page - 1, "‹ Prev", `aria-label="Previous page"${page === 1 ? " disabled" : ""}`)];
    for (const n of pageNumbers(page, pages)) {
      parts.push(n === "gap"
        ? `<span class="gap" aria-hidden="true">…</span>`
        : btn(n, String(n), `aria-label="Page ${n}"${n === page ? ` aria-current="page"` : ""}`));
    }
    parts.push(btn(page + 1, "Next ›", `aria-label="Next page"${page === pages ? " disabled" : ""}`));
    el.innerHTML = parts.join("");
    el.hidden = false;
    el.onclick = (e) => {
      const b = e.target.closest("button[data-page]");
      if (!b || b.disabled) return;
      const n = Number(b.dataset.page);
      if (n >= 1 && n <= pages && n !== page) go(n);
    };
  };
})();
