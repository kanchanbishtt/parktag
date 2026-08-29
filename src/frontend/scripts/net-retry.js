// Network requests that survive one bar of signal.
//
// The scan page is used in basement car parks, which is exactly where mobile
// data gives out, and every request it made was a bare `fetch` with no timeout.
// A stalled connection therefore never resolved and never rejected: the button
// stayed disabled, the status stayed "Preparing your call…", and the scanner was
// left holding a page that would sit there until they gave up and reloaded.
// That, not a slow download, is the failure this module exists to stop.
//
// Three things every call gets:
//
//   1. A deadline. An attempt that has not answered by then is aborted, so a
//      dead connection produces an error the page can actually show.
//   2. A word while it waits. Slow is not the same as broken, and a scanner who
//      is told it is still going will wait; one watching a frozen button will
//      not.
//   3. An honest ending. Either it worked, or it says so and gives the control
//      back.
//
// Retries are opt-in, and deliberately so. See `retries` below.

// Aborted because it ran past its deadline, as opposed to aborted by the
// caller — the page says something different for each, so they must be
// distinguishable.
export class RequestTimeout extends Error {
  constructor(ms) {
    super(`Request timed out after ${ms}ms`);
    this.name = "RequestTimeout";
    this.isTimeout = true;
  }
}

// Nothing came back at all: no DNS, no socket, no response. Distinct from an
// error the server chose to send, which arrives as a normal status code.
export class NetworkDown extends Error {
  constructor(cause) {
    super("The network did not answer");
    this.name = "NetworkDown";
    this.isNetworkDown = true;
    this.cause = cause;
  }
}

export const DEFAULT_TIMEOUT_MS = 12000;
// Long enough that a merely slow request is not interrupted, short enough that
// nobody stands next to a stranger's car wondering whether it is working.
export const SLOW_AFTER_MS = 3500;

// Worth another go: the request never produced an answer, or produced one the
// server itself describes as temporary. A 4xx is the server having considered
// the request and declined it — repeating it verbatim would only be declined
// again, so those are returned to the caller rather than retried.
function isRetryable(outcome) {
  if (outcome.error) return true;
  if (outcome.status === 429) return true;
  return outcome.status >= 500 && outcome.status <= 599;
}

// Exponential, with jitter so that a lift full of phones coming back into
// signal at the same moment do not retry in lockstep.
export function backoffDelay(attempt, { base = 600, cap = 6000, random = Math.random } = {}) {
  const ceiling = Math.min(cap, base * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

async function readBody(response) {
  // A proxy or captive portal on a bad connection answers with an HTML error
  // page, and calling .json() on that throws a SyntaxError whose message is
  // about JSON — which is how "Unexpected token < in JSON" ends up in front of
  // somebody trying to report a badly parked car.
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/**
 * Perform a JSON request with a deadline, and optionally retry it.
 *
 * Resolves to `{ ok, status, data }` for anything the server actually answered,
 * including 4xx and 5xx — the caller decides what those mean. It rejects only
 * when there was no answer at all: RequestTimeout or NetworkDown.
 *
 * `retries` is 0 by default, and callers must think before raising it. A GET is
 * free to repeat. A POST that books a call, spends a tag's one free contact or
 * messages an owner is NOT, because a request whose response was lost has still
 * been carried out: replaying it charges the scanner twice for one tap. Set it
 * above 0 only for a request the server can absorb twice.
 */
export async function requestJson(url, options = {}) {
  const {
    method = "GET",
    headers,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    slowAfterMs = SLOW_AFTER_MS,
    retries = 0,
    onSlow,
    onRetry,
    fetchImpl = typeof fetch === "function" ? fetch : null,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    random = Math.random,
    now = () => Date.now()
  } = options;

  if (!fetchImpl) throw new Error("No fetch implementation available");

  let lastFailure = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const outcome = await attemptOnce();

    if (!isRetryable(outcome)) {
      return { ok: outcome.response.ok, status: outcome.status, data: outcome.data };
    }

    lastFailure = outcome;

    if (attempt === retries) break;

    const delay = backoffDelay(attempt, { random });
    onRetry?.({ attempt: attempt + 1, of: retries, delayMs: delay });
    await sleep(delay);
  }

  // Out of attempts. A status means the server answered and kept failing, which
  // is still an answer the caller can render; only a silent line throws.
  if (lastFailure?.response) {
    return { ok: false, status: lastFailure.status, data: lastFailure.data };
  }
  throw lastFailure?.error ?? new NetworkDown();

  async function attemptOnce() {
    const controller = new AbortController();
    const startedAt = now();
    let timedOut = false;

    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Fires while the attempt is still open, so the page can stop looking
    // frozen without waiting for the whole deadline to run out.
    const slowNotice = onSlow
      ? setTimeout(() => onSlow({ elapsedMs: now() - startedAt }), slowAfterMs)
      : null;

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      const data = await readBody(response);
      return { response, status: response.status, data };
    } catch (error) {
      return { error: timedOut ? new RequestTimeout(timeoutMs) : new NetworkDown(error) };
    } finally {
      clearTimeout(deadline);
      if (slowNotice) clearTimeout(slowNotice);
    }
  }
}

// What to put in front of a person when there was no answer. Deliberately not
// error.message: "Failed to fetch" and "NetworkError when attempting to fetch
// resource" are the browser talking to a developer, and both were reaching the
// scan page verbatim.
export function offlineMessage(error, { action = "that" } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You appear to be offline. Check your signal and try again.";
  }
  if (error?.isTimeout) {
    return `The network is too slow to finish ${action}. Move somewhere with better signal and try again.`;
  }
  return `We could not reach ParkTag to finish ${action}. Check your signal and try again.`;
}
