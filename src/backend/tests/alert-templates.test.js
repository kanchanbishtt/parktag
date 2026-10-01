// The three alert templates submitted by scripts/create-alert-templates.js, and
// the sends that use them. No database and no network: the payloads are pure,
// and the sends run against a stubbed fetch with an env that is not a test run,
// so what would reach Meta can be read.
//
// What is pinned here is the pair of mistakes that only show up in production:
// a template whose shape Meta rejects at submission, and a send whose
// parameters do not match the template it names.

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { buildAlertTemplatePayloads } from "../scripts/create-alert-templates.js";
import {
  OWNER_ALERT_TEMPLATE,
  OWNER_ALERT_MAP_TEMPLATE,
  OWNER_ALERT_PLATE_TEMPLATE,
  EMERGENCY_LOCATION_TEMPLATE,
  FREE_TRIAL_ENDED_TEMPLATE,
  sendMetaWhatsappAlert,
  sendMetaWhatsappEmergencyLocation,
  sendMetaWhatsappFreeTrialEnded
} from "../lib/integrations/meta.js";
import { emergencyAlertFields } from "../lib/core/emergency-alert.js";

const payloads = buildAlertTemplatePayloads();
const byName = (name) => payloads.find((p) => p.name === name);
const part = (payload, type) => payload.components.find((c) => c.type === type);
const variables = (text) => [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

describe("the template submissions", () => {
  test("they are the three templates the code sends", () => {
    assert.deepEqual(
      payloads.map((p) => p.name),
      ["parktag_owner_notification_v4", "parktag_emergency_location_v1", "parktag_free_trial_ended"]
    );
    assert.deepEqual(
      payloads.map((p) => p.name),
      [OWNER_ALERT_PLATE_TEMPLATE, EMERGENCY_LOCATION_TEMPLATE, FREE_TRIAL_ENDED_TEMPLATE]
    );
  });

  for (const payload of payloads) {
    describe(payload.name, () => {
      const body = part(payload, "BODY");

      test("is UTILITY, in the language sendTemplate() asks for", () => {
        // None of these is gated on a marketing opt-in.
        assert.equal(payload.category, "UTILITY");
        assert.equal(payload.language, "en");
      });

      test("carries the house header and footer", () => {
        assert.deepEqual(part(payload, "HEADER"), { type: "HEADER", format: "TEXT", text: "ParkTag" });
        assert.deepEqual(part(payload, "FOOTER"), { type: "FOOTER", text: "Powered by ParkTag" });
      });

      test("has a body Meta accepts", () => {
        const found = variables(body.text);
        assert.deepEqual(found, found.map((_, i) => i + 1), "variables are numbered 1..n, each used once, in order");
        assert.equal(body.example.body_text[0].length, found.length, "one sample per variable");
        assert.doesNotMatch(body.text, /^\{\{/, "a body may not start with a variable");
        assert.doesNotMatch(body.text, /\}\}$/, "a body may not end with a variable");
        assert.doesNotMatch(body.text, /\}\}\s*\{\{/, "two variables may not be adjacent");
        assert.ok(body.text.length <= 1024);
      });

      test("names no price and makes no offer", () => {
        // What keeps it UTILITY. See docs/WHATSAPP_TEMPLATES.md 2.2 and 2.8.
        assert.doesNotMatch(body.text, /₹|Rs\.?\s*\d|\d+\s*%|\boffer\b|\bdiscount\b|\bupgrade\b|\bpremium\b/i);
        assert.doesNotMatch(body.text, /—/, "house style: no em-dashes");
      });

      test("any button is one URL ending in its single variable", () => {
        const buttons = part(payload, "BUTTONS")?.buttons || [];
        assert.ok(buttons.length <= 1);
        for (const button of buttons) {
          assert.equal(button.type, "URL");
          assert.ok(button.text.length <= 25, "Meta caps button text at 25 characters");
          assert.match(button.url, /^https:\/\/[^{]+\{\{1\}\}$/);
          assert.equal(button.example.length, 1);
          assert.ok(button.example[0].startsWith(button.url.replace("{{1}}", "")));
        }
      });
    });
  }

  test("the owner alert is v2's wording with the vehicle number added", () => {
    assert.equal(
      part(byName(OWNER_ALERT_PLATE_TEMPLATE), "BODY").text,
      "Hello {{1}}, someone scanned the ParkTag QR sticker on your vehicle *{{2}}* and reported: {{3}}.\n\n" +
        "Please check your vehicle when you can."
    );
    assert.equal(part(byName(OWNER_ALERT_PLATE_TEMPLATE), "BUTTONS"), undefined);
  });

  test("the emergency button opens the same map link the app builds", () => {
    const button = part(byName(EMERGENCY_LOCATION_TEMPLATE), "BUTTONS").buttons[0];
    // car-location.js carMapLink(): the base, then "lat,lng".
    assert.equal(button.url, "https://www.google.com/maps/search/?api=1&query={{1}}");
  });

  test("the free trial button goes to the owner's deep link, by tag id", () => {
    const button = part(byName(FREE_TRIAL_ENDED_TEMPLATE), "BUTTONS").buttons[0];
    assert.equal(button.url, "https://app.parktag.me/v/{{1}}");
  });
});

describe("what the emergency contact's message is filled with", () => {
  const point = { lat: 28.5677, lng: 77.323 };

  test("the masked plate, the landmark and the point", () => {
    assert.deepEqual(
      emergencyAlertFields({ plateNumber: "DL 9CP 4455", vehicleLabel: "Car" }, { ...point, place: "Wave Mall, Sector 18, Noida" }),
      { plate: "DL9CP####", place: "Wave Mall, Sector 18, Noida", mapQuery: "28.5677,77.323" }
    );
  });

  test("no landmark and no plate still fill every variable", () => {
    // Meta rejects a blank variable, so each has words to fall back on.
    const fields = emergencyAlertFields({ vehicleLabel: "Bike" }, point);
    assert.equal(fields.plate, "Bike");
    assert.equal(fields.place, "the point shown on the map");
    assert.equal(fields.mapQuery, "28.5677,77.323");
  });
});

describe("the sends", () => {
  // Not a test_ prefix, so external-guard lets the send reach the stub below.
  const env = { metaWhatsappPhoneNumberId: "1000", metaWhatsappAccessToken: "token", mongoCollectionPrefix: "unit_" };
  const TO = "+919000007720";
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;

  let sent;
  let unapproved;

  beforeEach(() => {
    sent = [];
    unapproved = new Set();
    console.warn = () => {};
    globalThis.fetch = async (url, init) => {
      assert.match(String(url), /^https:\/\/graph\.facebook\.com\//, "nothing but Meta is called");
      const { template } = JSON.parse(init.body);
      sent.push(template);
      // What Meta answers for a template that does not exist or is in review.
      if (unapproved.has(template.name)) {
        return { ok: false, status: 404, json: async () => ({ error: { message: "Template name does not exist in the translation" } }) };
      }
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.unit" }] }) };
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  });

  const bodyTexts = (template) => template.components.find((c) => c.type === "body").parameters.map((p) => p.text);
  const buttonText = (template) => template.components.find((c) => c.type === "button")?.parameters[0].text;
  const paramCount = (name) => variables(part(byName(name), "BODY").text).length;

  test("an owner alert with a plate uses the new template: name, plate, reason", async () => {
    await sendMetaWhatsappAlert(env, { to: TO, ownerName: "Girish", reason: "a window appears to be open or unlocked", tagId: "t1", plate: "DL9CP4455" });

    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, OWNER_ALERT_PLATE_TEMPLATE);
    assert.deepEqual(bodyTexts(sent[0]), ["Girish", "DL9CP4455", "a window appears to be open or unlocked"]);
    assert.equal(bodyTexts(sent[0]).length, paramCount(OWNER_ALERT_PLATE_TEMPLATE));
    assert.equal(buttonText(sent[0]), undefined, "the template has no button, so none may be sent");
  });

  test("until it is approved, the current alert goes out with the plate in its reason", async () => {
    unapproved.add(OWNER_ALERT_PLATE_TEMPLATE);

    await sendMetaWhatsappAlert(env, { to: TO, ownerName: "Girish", reason: "a window appears to be open or unlocked", tagId: "t1", plate: "DL9CP4455" });

    assert.deepEqual(sent.map((t) => t.name), [OWNER_ALERT_PLATE_TEMPLATE, OWNER_ALERT_TEMPLATE]);
    assert.deepEqual(bodyTexts(sent[1]), ["Girish", "a window appears to be open or unlocked (vehicle DL9CP4455)"]);
  });

  test("a shared location still sends the map alert, with the plate in its reason", async () => {
    await sendMetaWhatsappAlert(env, { to: TO, ownerName: "Girish", reason: "lights on, near Wave Mall", tagId: "t1", mapUrl: "https://app.parktag.me/m/abc.png", plate: "DL9CP4455" });

    assert.deepEqual(sent.map((t) => t.name), [OWNER_ALERT_MAP_TEMPLATE]);
    assert.deepEqual(bodyTexts(sent[0]), ["Girish", "lights on, near Wave Mall (vehicle DL9CP4455)"]);
  });

  test("a caller that passes no plate sends exactly what it sent before", async () => {
    // The locked-tag nudge and the emergency fallback: their sentence must not
    // be given a plate they did not ask for.
    await sendMetaWhatsappAlert(env, { to: TO, ownerName: "there", reason: "EMERGENCY reported", tagId: "t1" });

    assert.deepEqual(sent.map((t) => t.name), [OWNER_ALERT_TEMPLATE]);
    assert.deepEqual(bodyTexts(sent[0]), ["there", "EMERGENCY reported"]);
  });

  test("when every template is refused the caller is told", async () => {
    unapproved.add(OWNER_ALERT_PLATE_TEMPLATE).add(OWNER_ALERT_TEMPLATE);

    await assert.rejects(
      sendMetaWhatsappAlert(env, { to: TO, ownerName: "Girish", reason: "x", tagId: "t1", plate: "DL9CP4455" }),
      /Unable to send the WhatsApp message/
    );
  });

  test("the emergency location fills two variables and the map button", async () => {
    await sendMetaWhatsappEmergencyLocation(env, { to: TO, plate: "DL9CP####", place: "Wave Mall, Sector 18, Noida", mapQuery: "28.5677,77.323" });

    assert.equal(sent[0].name, EMERGENCY_LOCATION_TEMPLATE);
    assert.deepEqual(bodyTexts(sent[0]), ["DL9CP####", "Wave Mall, Sector 18, Noida"]);
    assert.equal(bodyTexts(sent[0]).length, paramCount(EMERGENCY_LOCATION_TEMPLATE));
    assert.equal(buttonText(sent[0]), "28.5677,77.323");
  });

  test("the free trial message fills two variables and the tag id button", async () => {
    await sendMetaWhatsappFreeTrialEnded(env, { to: TO, name: "Girish", plate: "DL9CP4455", tagId: "65f1a2b3c4d5e6f701234567" });

    assert.equal(sent[0].name, FREE_TRIAL_ENDED_TEMPLATE);
    assert.deepEqual(bodyTexts(sent[0]), ["Girish", "DL9CP4455"]);
    assert.equal(bodyTexts(sent[0]).length, paramCount(FREE_TRIAL_ENDED_TEMPLATE));
    assert.equal(buttonText(sent[0]), "65f1a2b3c4d5e6f701234567");
  });
});
