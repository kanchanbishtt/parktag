// The decision the reconciliation script makes about one order, tested against
// fixtures rather than against Razorpay.
//
// This is the part worth pinning down. Getting it wrong in one direction leaves
// a customer who paid with nothing; getting it wrong in the other ships stock
// against a payment that never completed. Neither shows up in a dry run's
// summary line, so the classifier is separated from the network and the
// database precisely so it can be exercised here.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { classifyOrder } from "../scripts/reconcile-razorpay-orders.js";

const paid = (amount = 19900) => ({ id: "order_x", status: "paid", amount, amount_paid: amount });
const captured = (id = "pay_ok") => ({ id, status: "captured" });

describe("reconciling a stranded order against Razorpay", () => {
  test("a fully paid order with a captured payment is fulfilled", () => {
    const verdict = classifyOrder(paid(), [captured("pay_abc")]);

    assert.equal(verdict.action, "fulfil");
    assert.equal(verdict.paymentId, "pay_abc");
  });

  test("an order nobody paid for is left alone", () => {
    const verdict = classifyOrder(
      { id: "order_x", status: "created", amount: 19900, amount_paid: 0 },
      []
    );

    assert.equal(verdict.action, "skip");
    assert.match(verdict.reason, /unpaid/);
  });

  // The buyer opened Razorpay and abandoned it. This is the ordinary shape of
  // an order sitting at "created", and by far the most common row the script
  // will walk past — treating it as recoverable would ship goods for free.
  test("an attempted-but-failed payment is not treated as paid", () => {
    const verdict = classifyOrder(
      { id: "order_x", status: "attempted", amount: 19900, amount_paid: 0 },
      [{ id: "pay_failed", status: "failed" }]
    );

    assert.equal(verdict.action, "skip");
  });

  // Never guess a payment id. An order Razorpay calls paid with nothing to
  // attribute it to is a question for a person, not something to fulfil and
  // record against a null payment.
  test("paid with no captured payment is escalated, not fulfilled", () => {
    const verdict = classifyOrder(paid(), []);

    assert.equal(verdict.action, "review");
    assert.equal(verdict.paymentId, undefined);
  });

  // Fulfilling on a part-payment ships the goods for less than they cost.
  test("a partial payment is escalated, not fulfilled", () => {
    const verdict = classifyOrder(
      { id: "order_x", status: "attempted", amount: 19900, amount_paid: 10000 },
      [captured("pay_partial")]
    );

    assert.equal(verdict.action, "review");
    assert.match(verdict.reason, /partial/);
  });

  test("a captured payment against an unpaid order is escalated", () => {
    const verdict = classifyOrder(
      { id: "order_x", status: "attempted", amount: 19900, amount_paid: 0 },
      [captured("pay_odd")]
    );

    assert.equal(verdict.action, "review");
    assert.match(verdict.reason, /captured-payment/);
  });

  test("an order Razorpay has never heard of is skipped, not fulfilled", () => {
    assert.equal(classifyOrder(null, []).action, "skip");
  });

  test("a missing payments array is treated as no payments", () => {
    assert.equal(classifyOrder(paid(), undefined).action, "review");
    assert.equal(
      classifyOrder({ id: "o", status: "created", amount: 19900, amount_paid: 0 }, undefined).action,
      "skip"
    );
  });

  // Only "captured" counts. An authorized-but-uncaptured payment is money on
  // hold that has not moved, and refunds must not read as a reason to ship.
  test("only captured payments count", () => {
    for (const status of ["authorized", "failed", "refunded", "created"]) {
      const verdict = classifyOrder(
        { id: "order_x", status: "attempted", amount: 19900, amount_paid: 0 },
        [{ id: `pay_${status}`, status }]
      );
      assert.equal(verdict.action, "skip", `${status} was treated as fulfillable`);
    }
  });

  test("the newest capture wins when an order somehow has two", () => {
    const verdict = classifyOrder(paid(), [captured("pay_first"), captured("pay_second")]);

    assert.equal(verdict.action, "fulfil");
    assert.equal(verdict.paymentId, "pay_second");
  });
});
