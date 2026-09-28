// M4: provider clients are built once per credential set, not per call.
import test from "node:test";
import assert from "node:assert/strict";

import { getRazorpay } from "../lib/integrations/payments.js";

const env = { razorpayKeyId: "rzp_test_a", razorpayKeySecret: "secret-a" };

test("the same Razorpay credentials share one client", () => {
  assert.equal(getRazorpay({ ...env }), getRazorpay({ ...env }));
});

test("rotated credentials get a new client, not the stale one", () => {
  const before = getRazorpay(env);
  const after = getRazorpay({ ...env, razorpayKeySecret: "secret-b" });
  assert.notEqual(before, after);
  assert.equal(getRazorpay(env), before);
});

test("no credentials, no client", () => {
  assert.equal(getRazorpay({ razorpayKeyId: "", razorpayKeySecret: "" }), null);
});
