# Dashboard load regression

PR #251 removed the local `localOnly` declaration when it moved tag reconciliation into `dashboardTags`, but left the migration check at the end of `load()`. A successful API response rendered cards and updated counters, then threw `ReferenceError: localOnly is not defined`. The shared catch replaced the grid with the load error, leaving the correct counters visible.

The correction derives pending placeholders from the reconciled list by excluding the original API tag objects. The reconciler preserves object identity. This restores migration without submitting existing server tags again.

The regression tests execute the actual complete `load()` function and card/grid renderers in a VM with browser/API dependencies stubbed. Four scenarios (2/11 premium tags, pending vehicles present/absent) reproduced the ReferenceError before the correction and pass afterward. All seven dashboard multiple-tag tests pass. These tests verify rendering and migration, not live customer ownership recovery.

## Retry button (audit item 9, 2026-10-13)

`welcome.js` is a `type="module"` script, so its functions are not globals and an inline `onclick="..."` attribute cannot call them. The load-error card used `onclick="load()"`, which threw `ReferenceError: load is not defined` on every tap. Retry is now bound with `addEventListener` right after the card is drawn. Any new inline handler in this file must call something put on `window` on purpose (as `switchTab`, `applyNbFilter` and the others are), or be bound in code.

A non-OK dashboard response (not 401/403) now counts as a failed load. Before, it drew only the "Add Vehicle" card, which read as an account with no vehicles.

`tests/dashboard-retry.test.js` runs the real `load()` in jsdom with `runScripts: "dangerously"`, so inline handlers execute against the global scope just as in a browser; the old markup reproduces the ReferenceError there.
