# Google redirect sign-in: state bound to the browser

The OAuth `state` is stored in `oauth_states` (single use, 10 minutes) together with a
hash of the id of the browser that started the sign-in.

## Why

A stored state only proved that somebody had started a sign-in. Anyone could start
one, approve it with their own Google account, stop before the callback, and send the
callback link to someone else. Opening it signed that browser into the sender's
account (login CSRF), and whatever the victim then saved went to the sender.

## How

- `/api/auth/google` and `/api/auth/admin/google` give the browser a random 256-bit id
  in `pt_google_browser` (reused if it already has one): HttpOnly, SameSite=Lax (Google
  returns with a top-level navigation; Strict would drop it), path
  `/api/auth/google/callback` only, 10 minutes, Secure on HTTPS. The state row stores
  `sha256(id)`, never the id.
- The callback consumes the state only if the presenting browser's id hashes to the
  stored value (`findOneAndDelete({ _id: state, browser })`). Otherwise it answers
  `invalid_state` and leaves the state alone, so a refused link does not burn the
  sign-in for the browser it belongs to.
- One id per browser, not the state itself in the cookie, so sign-ins started in two
  tabs both complete. The cookie is not cleared at the callback for the same reason;
  it is useless without a live state started alongside it.

One Tap (`/credential`) and the popup route (`/popup`) are POSTs, which the origin
check already covers.
