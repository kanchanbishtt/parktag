// A bot-check token that is ready the moment the buyer taps "pay".
//
// Google accepts a reCAPTCHA token for two minutes. The checkout mints one when
// the delivery step opens, so it is in hand by the time the buyer has typed
// their address. But typing an address takes longer than two minutes for most
// people, so that first token was usually stale when it was needed, and a new
// one was minted at the tap: Google's script called, a round trip waited on,
// with the buyer watching "Opening secure payment".
//
// This keeps one in hand for as long as the step is open: mint at open, and
// again every REFRESH_MS, so the newest is always young enough to send.
//
// `mint` returns a promise for a token, or for "" when the bot check is not
// configured or could not run; it never rejects (see recaptcha.js).

// A token is sent only while comfortably inside Google's two minutes.
const FRESH_MS = 90 * 1000;
// Minted again a little before the last one stops being sendable.
const REFRESH_MS = 75 * 1000;

export function keepFreshToken(mint, {
  freshMs = FRESH_MS,
  refreshMs = REFRESH_MS,
  now = Date.now,
  setTimer = setInterval,
  clearTimer = clearInterval
} = {}) {
  let latest = { at: now(), token: mint() };
  let stopped = false;
  const timer = setTimer(() => { latest = { at: now(), token: mint() }; }, refreshMs);

  // Call when the token will not be needed after all (the buyer backed out), so
  // a closed checkout does not go on calling Google.
  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimer(timer);
  }

  // The token to send with the order. The newest one if it is still young;
  // otherwise a new one, minted now. That is the old behaviour, and is only
  // reached when the timer could not run (a tab left in the background). Each
  // token is good for one order, so this also ends the refreshing.
  async function take() {
    stop();
    const kept = now() - latest.at < freshMs ? await latest.token : "";
    return kept || mint();
  }

  return { take, stop };
}
