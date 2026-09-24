// What leaves the process when an error is reported to Sentry.
//
// WaveTag exists to keep an owner's phone number hidden, and server errors are
// raised while handling exactly that data. These tests pin the scrubbing so a
// later SDK upgrade or config change cannot quietly start shipping it.
import test from "node:test";
import assert from "node:assert/strict";

import { redactText, scrubEvent, shouldReport } from "../lib/integrations/sentry.js";

test("phone numbers are masked with or without a country code", () => {
  assert.equal(redactText("dup key: { mobile: \"9876543210\" }"), "dup key: { mobile: \"[number]\" }");
  assert.equal(redactText("call to +91 98765 43210 failed"), "call to [number] failed");
  assert.equal(redactText("otp 482913 expired"), "otp [number] expired");
});

test("emails are masked", () => {
  assert.equal(redactText("no owner owner.name@example.com"), "no owner [email]");
});

test("short numbers such as status codes survive", () => {
  assert.equal(redactText("Exotel answered 502 after 3 tries"), "Exotel answered 502 after 3 tries");
});

test("request, user, breadcrumbs and local variables are removed", () => {
  const event = scrubEvent({
    message: "failed for 9876543210",
    request: { url: "/api/x?phone=9876543210", headers: { cookie: "sid=abc" } },
    user: { ip_address: "1.2.3.4" },
    breadcrumbs: [{ category: "http", data: { url: "https://key:secret@api.exotel.com" } }],
    exception: {
      values: [{
        value: "E11000 duplicate key { mobile: \"9876543210\" }",
        stacktrace: { frames: [{ function: "claim", vars: { mobile: "9876543210" } }] }
      }]
    }
  });

  assert.equal(event.request, undefined);
  assert.equal(event.user, undefined);
  assert.equal(event.breadcrumbs, undefined);
  assert.equal(event.message, "failed for [number]");
  assert.equal(event.exception.values[0].value, "E11000 duplicate key { mobile: \"[number]\" }");
  assert.equal(event.exception.values[0].stacktrace.frames[0].vars, undefined);
  assert.doesNotMatch(JSON.stringify(event), /9876543210|secret|sid=/);
});

test("only server failures are reported, not client errors", () => {
  assert.equal(shouldReport(500), true);
  assert.equal(shouldReport(503), true);
  assert.equal(shouldReport(undefined), true);
  assert.equal(shouldReport(400), false);
  assert.equal(shouldReport(404), false);
  assert.equal(shouldReport(429), false);
});

test("a user-facing clientError is not reported even when it answers 500", () => {
  assert.equal(shouldReport(500, { expose: true, message: "Invalid plate" }), false);
  assert.equal(shouldReport(500, new Error("db down")), true);
});
