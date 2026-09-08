// Nothing a test does may reach a provider that charges money or messages a
// stranger.
//
// ── What went wrong ────────────────────────────────────────────────────────
//
// The Delhivery wallet went to MINUS Rs 660 on a week where nobody bought
// anything. Thirty-nine shipments, all 50gm, all "Shipment Manifested", and no
// matching order in any shop_orders collection — because the suites that
// created them delete their own rows in beforeEach.
//
// They were the test suite. `guest-checkout.test.js` seeds an order whose id is
// `order_guest_<hex>`, posts to /api/shop/guest/verify-payment, and
// fulfilPaidOrder books a REAL courier shipment. `place-cod` does the same with
// the order NUMBER, which is why `PT-2609xx-000xx` appears in the ledger too.
// Each run booked parcels Delhivery then expects to collect.
//
// The same path also sent WhatsApp. That suite blanks the Razorpay keys and not
// the Meta ones, and its fixture address carries the phone number 9812345678 —
// a real, dialable Indian mobile belonging to somebody who has never heard of
// ParkTag. Every run sent them an order confirmation, from the same number that
// carries ParkTag's login codes. If they report it, the quality rating that
// drops is the one the owner alert depends on.
//
// ── Why the guard lives here and not in the tests ──────────────────────────
//
// It was already "in the tests" and that is exactly what failed. helpers.js
// documents this hazard in full and offers assertUndeliverableIdentifier;
// guest-checkout.test.js simply does not call it, and nothing made it. Per-test
// discipline fails silently, and the failure is invisible until somebody reads
// a courier invoice.
//
// So this works like assertDisposableDatabase: a single choke point that makes
// the bad thing IMPOSSIBLE rather than remembered. The signal is the same one
// that function already trusts — a collection prefix that reads as throwaway.
// If a run is pointed at test_ or ci_ data, it is a test run, and a test run
// does not get to spend money or message the public.

const DISPOSABLE_PREFIX = /^(test|ci)[_-]/i;

/**
 * Is this a throwaway run?
 *
 * Read from the collection prefix rather than NODE_ENV, because the prefix is
 * what assertDisposableDatabase already gates on and it is the value a test run
 * genuinely cannot avoid setting: the suite refuses to start without it.
 * NODE_ENV is unset in plenty of legitimate local runs and would be the weaker
 * signal.
 */
export function isDisposableRun(env) {
  return DISPOSABLE_PREFIX.test((env && env.mongoCollectionPrefix) || "");
}

/**
 * Refuse an outbound call that costs money or reaches a member of the public.
 *
 * THROWS, deliberately, rather than returning quietly. Every caller of these
 * providers is already best-effort and catches its own failures — shipment
 * booking records the error on the order for retry, and the notification
 * senders log and carry on — so a throw here is absorbed exactly like a
 * provider outage, which is the behaviour these paths are already tested for.
 *
 * The alternative, silently returning a fake success, would leave a test
 * asserting against a shipment that does not exist. An error that reads like an
 * outage is both honest and already handled.
 */
export function refuseInTestRun(env, what) {
  if (!isDisposableRun(env)) return;

  const err = new Error(
    `${what} is refused during a test run (MONGODB_COLLECTION_PREFIX=` +
      `"${(env && env.mongoCollectionPrefix) || ""}"). This call would have cost real money ` +
      `or reached a real person. See lib/core/external-guard.js.`
  );
  err.refusedByTestGuard = true;
  throw err;
}
