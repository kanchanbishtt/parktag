// Requests that survive one bar of signal.
//
// The scan page ran every request through a bare `fetch` with no deadline, so a
// stalled connection neither resolved nor rejected: the button stayed disabled
// and the status stayed "Preparing your call…" until the scanner gave up. These
// tests are mostly about that — a request must always end.
//
// The other half is about what must NOT be retried. `register-call` sets
// `freeContactUsed` before its response leaves the server, so replaying a POST
// whose answer was lost hands an E-Tag scanner a 402 "free contact already
// used" for a call that in fact worked. Retries are therefore opt-in, and the
// default is locked down here so nobody turns them on by accident.
//
// No database and no browser: fetch, sleep, randomness and the clock are all
// injected, which is the point of the module taking them as options.
import test from "node:test";
import assert from "node:assert/strict";

import {
  requestJson,
  backoffDelay,
  offlineMessage,
  RequestTimeout,
  NetworkDown,
  DEFAULT_TIMEOUT_MS
} from "../../frontend/scripts/net-retry.js";

// A stand-in for fetch that plays back a scripted list of outcomes.
function scriptedFetch(steps) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, options });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];

    if (step.throw) throw step.throw;
    if (step.hang) {
      // Never answers on its own; only the caller's deadline ends it.
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      text: async () => (step.body === undefined ? "{}" : step.body)
    };
  };
  impl.calls = calls;
  return impl;
}

const noSleep = async () => {};

test("a successful request returns the parsed body", async () => {
  const fetchImpl = scriptedFetch([{ status: 200, body: '{"ok":true,"virtualNumber":"08047284348"}' }]);
  const result = await requestJson("/api/x", { fetchImpl, sleep: noSleep });

  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.data.virtualNumber, "08047284348");
  assert.equal(fetchImpl.calls.length, 1);
});

test("retries are off unless asked for", async () => {
  // The guard that matters. A POST that books a call or spends a tag's one free
  // contact has still been carried out when its response is lost, so a default
  // of "just try again" would charge the scanner twice for one tap.
  const fetchImpl = scriptedFetch([{ throw: new Error("Failed to fetch") }]);

  await assert.rejects(
    () => requestJson("/api/tags/abc/register-call", { method: "POST", fetchImpl, sleep: noSleep }),
    (error) => error instanceof NetworkDown
  );
  assert.equal(fetchImpl.calls.length, 1, "exactly one attempt, no silent replay");
});

test("a request that never answers still ends", async () => {
  // The whole reason this module exists: without a deadline this hangs forever
  // and the page sits on a disabled button.
  const fetchImpl = scriptedFetch([{ hang: true }]);

  await assert.rejects(
    () => requestJson("/api/tags/abc", { fetchImpl, timeoutMs: 40, sleep: noSleep }),
    (error) => {
      assert.ok(error instanceof RequestTimeout, "must report a timeout, not a generic failure");
      assert.equal(error.isTimeout, true);
      return true;
    }
  );
});

test("the deadline aborts the request rather than abandoning it", async () => {
  const fetchImpl = scriptedFetch([{ hang: true }]);
  await requestJson("/api/tags/abc", { fetchImpl, timeoutMs: 30, sleep: noSleep }).catch(() => {});

  assert.equal(fetchImpl.calls[0].options.signal.aborted, true,
    "a request left open holds a socket the phone is not going to get back");
});

test("a flaky GET recovers on a later attempt", async () => {
  const fetchImpl = scriptedFetch([
    { throw: new Error("Failed to fetch") },
    { throw: new Error("Failed to fetch") },
    { status: 200, body: '{"ok":true,"tag":{"status":"active"}}' }
  ]);

  const result = await requestJson("/api/tags/abc", {
    fetchImpl, retries: 3, sleep: noSleep, random: () => 0.5
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.tag.status, "active");
  assert.equal(fetchImpl.calls.length, 3);
});

test("a 4xx is handed back, never repeated", async () => {
  // The server considered the request and declined it. Repeating it verbatim
  // would be declined again -- and for 402 it would also overwrite a correct
  // "free contact used" answer with more of the same.
  const fetchImpl = scriptedFetch([{ status: 402, body: '{"ok":false,"code":"FREE_USED"}' }]);

  const result = await requestJson("/api/contact-requests", {
    method: "POST", fetchImpl, retries: 3, sleep: noSleep
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 402);
  assert.equal(result.data.code, "FREE_USED");
  assert.equal(fetchImpl.calls.length, 1, "a refusal must not be retried");
});

test("a 5xx and a 429 are worth another go", async () => {
  for (const status of [500, 503, 429]) {
    const fetchImpl = scriptedFetch([{ status }, { status: 200, body: '{"ok":true}' }]);
    const result = await requestJson("/api/tags/abc", {
      fetchImpl, retries: 2, sleep: noSleep, random: () => 0.5
    });
    assert.equal(result.ok, true, `${status} should have been retried`);
    assert.equal(fetchImpl.calls.length, 2);
  }
});

test("a server that keeps failing returns its answer instead of throwing", async () => {
  // A 503 is still the server talking. The page can say something specific
  // about it, which it cannot do for a silent line.
  const fetchImpl = scriptedFetch([{ status: 503, body: '{"ok":false,"error":"Call service is not configured."}' }]);
  const result = await requestJson("/api/x", { fetchImpl, retries: 2, sleep: noSleep, random: () => 0.5 });

  assert.equal(result.status, 503);
  assert.equal(result.data.error, "Call service is not configured.");
});

test("an HTML error page does not become a JSON parse error", async () => {
  // A captive portal or proxy on a bad connection answers with HTML, and
  // .json() on that throws "Unexpected token < in JSON" -- which was reaching
  // the scan page verbatim.
  const fetchImpl = scriptedFetch([{ status: 502, body: "<html><body>Bad Gateway</body></html>" }]);
  const result = await requestJson("/api/x", { fetchImpl, sleep: noSleep });

  assert.equal(result.status, 502);
  assert.deepEqual(result.data, {}, "an unparseable body is simply empty");
});

test("an empty body is not an error either", async () => {
  const fetchImpl = scriptedFetch([{ status: 204, body: "" }]);
  const result = await requestJson("/api/x", { fetchImpl, sleep: noSleep });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {});
});

test("the page is told it is slow before it is told it failed", async () => {
  // Slow is not broken. A scanner who is told it is still going will wait; one
  // watching a frozen button will not.
  const fetchImpl = scriptedFetch([{ hang: true }]);
  const notices = [];

  await requestJson("/api/x", {
    fetchImpl,
    timeoutMs: 90,
    slowAfterMs: 15,
    onSlow: (info) => notices.push(info),
    sleep: noSleep
  }).catch(() => {});

  assert.equal(notices.length, 1, "exactly one nudge per attempt");
  assert.equal(typeof notices[0].elapsedMs, "number");
});

test("a request that answers quickly says nothing", async () => {
  const fetchImpl = scriptedFetch([{ status: 200, body: '{"ok":true}' }]);
  let nudged = false;
  await requestJson("/api/x", {
    fetchImpl, slowAfterMs: 50, onSlow: () => { nudged = true; }, sleep: noSleep
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(nudged, false, "the nudge must be cancelled when the answer arrives");
});

test("each retry is announced so the wait can be explained", async () => {
  const fetchImpl = scriptedFetch([
    { throw: new Error("boom") },
    { throw: new Error("boom") },
    { status: 200, body: '{"ok":true}' }
  ]);
  const seen = [];

  await requestJson("/api/x", {
    fetchImpl, retries: 3, sleep: noSleep, random: () => 0.5,
    onRetry: (info) => seen.push(info)
  });

  assert.equal(seen.length, 2);
  assert.deepEqual(seen.map((s) => s.attempt), [1, 2]);
  assert.ok(seen.every((s) => s.delayMs > 0), "and how long the next wait is");
});

test("backoff grows, is capped, and is jittered", async () => {
  const atFloor = [0, 1, 2, 3, 8].map((n) => backoffDelay(n, { random: () => 0 }));
  const atCeiling = [0, 1, 2, 3, 8].map((n) => backoffDelay(n, { random: () => 1 }));

  assert.deepEqual(atFloor, [300, 600, 1200, 2400, 3000], "grows, then holds at the cap");
  assert.deepEqual(atCeiling, [600, 1200, 2400, 4800, 6000]);
  for (let i = 0; i < atFloor.length; i += 1) {
    assert.ok(atCeiling[i] > atFloor[i],
      "jitter must spread retries -- a lift full of phones regaining signal must not sync up");
  }
});

test("the deadline has a sane default", () => {
  assert.ok(DEFAULT_TIMEOUT_MS >= 8000 && DEFAULT_TIMEOUT_MS <= 20000,
    "long enough for a slow connection, short enough that nobody stands there guessing");
});

test("what a person is told never mentions fetch", async () => {
  // "Failed to fetch" and "NetworkError when attempting to fetch resource" are
  // the browser talking to a developer, and both were reaching the scan page.
  const messages = [
    offlineMessage(new NetworkDown(new Error("Failed to fetch")), { action: "your call" }),
    offlineMessage(new RequestTimeout(12000), { action: "your call" })
  ];

  for (const message of messages) {
    assert.doesNotMatch(message, /fetch|NetworkError|undefined|\[object/i);
    assert.match(message, /signal|offline/i, "it should say what to actually do about it");
    assert.ok(message.length < 140);
  }
});

test("a timeout and a dead line read differently", () => {
  const slow = offlineMessage(new RequestTimeout(12000), { action: "your call" });
  const dead = offlineMessage(new NetworkDown(new Error("x")), { action: "your call" });
  assert.notEqual(slow, dead, "'too slow' and 'no connection' are different problems");
});
