// Keep a signed-out visitor off a signed-in page that the browser brought back
// from history.
//
// The server already sends `Cache-Control: no-store` on these pages and answers
// a signed-out request with a redirect, but neither helps here: pressing Back
// restores the page from the browser's back/forward cache, which is a snapshot
// of the live document — no request is made, so there is nothing for the server
// to redirect. `no-store` is widely assumed to prevent this and does not;
// Chrome restores no-store pages from bfcache in most situations today.
//
// So the check has to happen in the page itself, on the one event that fires
// when a document is resurrected rather than loaded.
const SIGN_IN_URL = "/owner-login";

async function hasLiveSession() {
  const response = await fetch("/api/session", {
    // Without this the check itself could be answered from cache, which would
    // defeat the point of making it.
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  });

  if (!response.ok) return null; // indeterminate — see the caller
  const data = await response.json();
  return Boolean(data && data.session);
}

window.addEventListener("pageshow", async (event) => {
  // `persisted` is true only for a bfcache restore. A normal load already went
  // through the server, which redirects a signed-out visitor on its own, so
  // re-checking there would be a pointless request on every page view.
  if (!event.persisted) return;

  let signedIn;
  try {
    signedIn = await hasLiveSession();
  } catch {
    // Offline, or the request failed. Deliberately do nothing: throwing someone
    // out of a page they are legitimately signed into because their connection
    // dropped for a moment is a worse bug than the one this fixes.
    return;
  }

  // null means the server answered but not usefully (a 429, say). Same reasoning
  // as above — only act on a definite "there is no session".
  if (signedIn === false) {
    // replace(), not assign(): the restored page is the current history entry,
    // and replacing it means pressing Back again does not simply return to it.
    window.location.replace(SIGN_IN_URL);
  }
});
