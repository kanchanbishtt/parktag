# CI checks

The `CI` workflow runs for PRs targeting `main`/`staging` and pushes to those branches. A newer commit cancels an older run of the same PR. Push runs are kept independent so release verification is not interrupted.

Change detection runs before services start. Backend changes (`src/`, root package files, `.github/`) run every backend test across three Node test-runner shards. Each shard gets a separate GitHub runner, MongoDB container and database. Files remain sequential within each shard because suites clear shared fixture collections. Keep the glob identical in all shards; Node's `--test-shard=N/3` partitions it without a hand-maintained file list. Local `npm test` still runs the entire suite sequentially.

JavaScript syntax and server boot checks run in shard 1. Landing changes build the landing app in a separate job. Documentation-only changes do not start MongoDB or install dependencies. Unknown diff bases run both areas.

The final required check remains `verify`. It runs even if an upstream job fails or is skipped, and passes only when change detection succeeds and each required area passes. Intentionally unneeded areas must be skipped. Keep this gate when updating branch protection or Railway checks.

Three runners reduce elapsed waiting time but can use more total runner minutes due to repeated setup. Test counts and actual run duration should be checked on the PR. No production credentials are used.
