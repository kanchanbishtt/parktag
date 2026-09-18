# Dashboard load regression

PR #251 removed the local `localOnly` declaration when it moved tag reconciliation into `dashboardTags`, but left the migration check at the end of `load()`. A successful API response rendered cards and updated counters, then threw `ReferenceError: localOnly is not defined`. The shared catch replaced the grid with the load error, leaving the correct counters visible.

The correction derives pending placeholders from the reconciled list by excluding the original API tag objects. The reconciler preserves object identity. This restores migration without submitting existing server tags again.

The regression tests execute the actual complete `load()` function and card/grid renderers in a VM with browser/API dependencies stubbed. Four scenarios (2/11 premium tags, pending vehicles present/absent) reproduced the ReferenceError before the correction and pass afterward. All seven dashboard multiple-tag tests pass. These tests verify rendering and migration, not live customer ownership recovery.
