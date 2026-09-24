# Error Monitoring (Sentry)

Code: `src/backend/lib/integrations/sentry.js`. Enabled only when `SENTRY_DSN`
is set, so dev, CI and tests send nothing.

## What is reported

- 5xx responses from the Fastify error handler, tagged with method, route
  pattern (for example `/t/:token`) and status.
- Unhandled promise rejections and uncaught exceptions, from `server.js`.
- Not reported: 4xx, and any `clientError()` even when it answers 500, since
  its message was written for the user and marks a validation outcome.

The SDK's own uncaught-exception and unhandled-rejection handlers are removed:
`server.js` already decides whether the process keeps serving or drains and
exits, and it reports to Sentry itself.

## What never leaves the process

WaveTag's promise is that an owner's number stays hidden, and server errors
happen while handling that data. Every event is stripped in `beforeSend`:

- `request` (URL, query, headers, cookies, body), `user`, and breadcrumbs.
- Local variables on stack frames.
- Emails and runs of six or more digits in messages, which covers mobiles with
  or without +91 and six-digit OTPs. Mongo duplicate-key errors quote the
  offending value, which is why this matters.

Source-code context lines are still sent. They contain only our own code.
Tracing is off (`beforeSendTransaction` drops everything).

## Setup

1. Create a Node.js project in Sentry and copy its DSN (Settings → Client Keys).
2. Set `SENTRY_DSN` in Railway. `release` comes from `RAILWAY_GIT_COMMIT_SHA`.
3. Check the first event in Sentry shows `[number]` / `[email]` masks and no
   request section.
