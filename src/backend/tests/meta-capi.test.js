// The server half of the Pixel. Four properties matter here, and each fails
// silently rather than loudly if it breaks:
//
//   1. Unconfigured is a no-op. Dev and staging have no access token and must
//      never write events into the live dataset.
//
//   2. Event ids are deterministic and match what the browser produces. If they
//      drift, every online purchase is counted twice — once from the Pixel and
//      once from here — and Meta optimises against inflated revenue.
//
//   3. Identifiers are hashed and normalised the way Meta expects. An
//      unnormalised hash is simply a different hash: it matches nobody, so the
//      event lands anonymous and the whole point of sending it is lost. This is
//      the failure mode that looks like "it works" in the logs.
//
//   4. Nothing raw leaks. No plate, no tag token, no unhashed phone.
//
// No database and no network: this is pure payload construction.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isMetaCapiConfigured,
  sendCapiEvent,
  purchaseEventId,
  activationEventId
} from "../lib/integrations/meta-capi.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const CONFIGURED = { metaPixelId: "1383269377346358", metaCapiAccessToken: "test-token" };

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("meta capi configuration", () => {
  test("needs both a pixel id and an access token", () => {
    assert.equal(isMetaCapiConfigured({}), false);
    assert.equal(isMetaCapiConfigured({ metaPixelId: "123" }), false);
    assert.equal(isMetaCapiConfigured({ metaCapiAccessToken: "t" }), false);
    assert.equal(isMetaCapiConfigured(CONFIGURED), true);
  });

  test("sending is a no-op when unconfigured", async () => {
    // No network call is attempted, so this cannot hang or write anywhere.
    const result = await sendCapiEvent({}, { eventName: "Purchase", eventId: "x" });
    assert.deepEqual(result, { ok: false, skipped: "not-configured" });
  });
});

describe("event ids", () => {
  test("a purchase id matches the string the browser builds", async () => {
    // assets/analytics.js does: name + ":" + params.transaction_id, with the
    // GA4 name "purchase". Both halves must land on the same string or Meta
    // records two conversions for one sale. Read the browser source rather
    // than restating its rule, so this fails if that line ever changes.
    const browser = await fs.readFile(path.join(currentDir, "../assets/analytics.js"), "utf8");
    assert.match(browser, /return name \+ ":" \+ params\.transaction_id;/);

    assert.equal(purchaseEventId("PT-1001"), "purchase:PT-1001");
  });

  test("an activation id is keyed on the tag", () => {
    assert.equal(activationEventId("abc123"), "tag_activated:abc123");
  });
});

describe("payload construction", () => {
  // Capture what would have gone over the wire without letting it leave.
  async function capture(event, env = CONFIGURED) {
    const original = globalThis.fetch;
    let captured = null;

    globalThis.fetch = async (url, options) => {
      captured = { url, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({}) };
    };

    try {
      await sendCapiEvent(env, event);
    } finally {
      globalThis.fetch = original;
    }

    return captured;
  }

  test("hashes an Indian mobile with its country code", async () => {
    // A bare 10-digit number has to be normalised to 91XXXXXXXXXX, or it
    // hashes to something the browser's +91 form never matches.
    const sent = await capture({
      eventName: "TagActivated",
      eventId: "tag_activated:1",
      userData: { phone: "9876543210" }
    });

    assert.deepEqual(sent.body.data[0].user_data.ph, [sha256("919876543210")]);
  });

  test("a +91 number and a bare number hash identically", async () => {
    const a = await capture({ eventName: "X", eventId: "1", userData: { phone: "+91 98765 43210" } });
    const b = await capture({ eventName: "X", eventId: "1", userData: { phone: "9876543210" } });

    assert.deepEqual(a.body.data[0].user_data.ph, b.body.data[0].user_data.ph);
  });

  test("lowercases and trims an email before hashing", async () => {
    const sent = await capture({
      eventName: "Purchase",
      eventId: "purchase:1",
      userData: { email: "  Buyer@ParkTag.ME " }
    });

    assert.deepEqual(sent.body.data[0].user_data.em, [sha256("buyer@parktag.me")]);
  });

  test("never sends a raw phone or email anywhere in the payload", async () => {
    const sent = await capture({
      eventName: "Purchase",
      eventId: "purchase:PT-9",
      userData: { phone: "9876543210", email: "buyer@parktag.me" },
      customData: { value: 499, currency: "INR" }
    });

    const wire = JSON.stringify(sent.body);
    assert.ok(!wire.includes("9876543210"), "raw phone must never be sent");
    assert.ok(!wire.includes("buyer@parktag.me"), "raw email must never be sent");
    assert.ok(!wire.includes("919876543210"), "raw phone must never be sent, normalised or not");
  });

  test("omits identifiers that were not supplied", async () => {
    // A missing phone must leave the key out rather than send a hash of "",
    // which would be a constant that matches every other identifier-less event.
    const sent = await capture({ eventName: "Purchase", eventId: "purchase:1", userData: {} });
    const userData = sent.body.data[0].user_data;

    assert.ok(!("ph" in userData));
    assert.ok(!("em" in userData));
  });

  test("carries the event id and name Meta will deduplicate on", async () => {
    const sent = await capture({
      eventName: "Purchase",
      eventId: purchaseEventId("PT-42"),
      customData: { value: 499, currency: "INR" }
    });

    const payload = sent.body.data[0];
    assert.equal(payload.event_name, "Purchase");
    assert.equal(payload.event_id, "purchase:PT-42");
    assert.equal(payload.custom_data.value, 499);
    assert.match(sent.url, /1383269377346358\/events$/);
  });
});
