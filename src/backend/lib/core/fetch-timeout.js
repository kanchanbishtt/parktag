// `fetch` with a hard deadline. Node's undici waits up to five minutes for
// response headers, so one hung provider used to pin a request, a Mongo
// operation and a rate-limit slot that long. The deadline covers the body read
// too, and rejects like any other network failure, so existing catch paths
// keep working.
//
// `fetch` is looked up at call time so tests that stub globalThis.fetch still
// intercept. A caller-supplied signal is honoured alongside the deadline.
export const DEFAULT_FETCH_TIMEOUT_MS = 8000;

export function fetchWithTimeout(url, options = {}, ms = DEFAULT_FETCH_TIMEOUT_MS) {
  const deadline = AbortSignal.timeout(ms);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  return fetch(url, { ...options, signal });
}
