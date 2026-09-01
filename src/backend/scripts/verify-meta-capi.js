// Send one of each server-side conversion to Meta's Test Events view.
//
// Deliberately goes through the REAL sender in lib/integrations/meta-capi.js
// rather than a hand-rolled fetch. A script that builds its own payload proves
// only that the script works; this proves the code the payment and activation
// paths actually run works, including the hashing and normalisation, which is
// where this fails silently in production.
//
// Nothing is written to the live dataset: every event carries a
// test_event_code, which routes it to Events Manager → Test events instead of
// reporting. Safe to run against the production pixel.
//
//   META_PIXEL_ID=... \
//   META_CAPI_ACCESS_TOKEN=... \
//   META_CAPI_TEST_EVENT_CODE=TEST00000 \
//     node src/backend/scripts/verify-meta-capi.js
//
// The phone below is a documentation-range number, not anyone's. It exists to
// prove the hash is computed and sent, so the match rate in Events Manager will
// be low for these two events — that is expected and is not a failure.

import {
  sendCapiEvent,
  isMetaCapiConfigured,
  purchaseEventId,
  activationEventId
} from "../lib/integrations/meta-capi.js";

const env = {
  metaPixelId: process.env.META_PIXEL_ID || "",
  metaCapiAccessToken: process.env.META_CAPI_ACCESS_TOKEN || ""
};

const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE || "";

// Reserved for documentation and never allocated to a real subscriber.
const SAMPLE_PHONE = "+919999999999";

function line(label, value) {
  console.log(`  ${label.padEnd(18)} ${value}`);
}

async function main() {
  if (!isMetaCapiConfigured(env)) {
    console.error(
      "\nNot configured. Set META_PIXEL_ID and META_CAPI_ACCESS_TOKEN.\n" +
        "The access token comes from Events Manager → your pixel → Settings →\n" +
        "Set up direct integration → Generate access token.\n"
    );
    process.exit(1);
  }

  if (!testEventCode) {
    // Refusing rather than defaulting: without the code these events would land
    // in live reporting as real conversions, and a fake purchase in the ad
    // account's optimisation data is not something to do by accident.
    console.error(
      "\nRefusing to run without META_CAPI_TEST_EVENT_CODE.\n" +
        "Without it these events count as REAL conversions in live reporting.\n" +
        "Copy the code from Events Manager → Test events.\n"
    );
    process.exit(1);
  }

  console.log(`\nSending to pixel ${env.metaPixelId}, test code ${testEventCode}\n`);

  const cases = [
    {
      title: "Purchase (what a paid order sends)",
      event: {
        eventName: "Purchase",
        eventId: purchaseEventId("VERIFY-0001"),
        actionSource: "website",
        userData: { phone: SAMPLE_PHONE, email: "verify@parktag.me" },
        customData: {
          value: 499,
          currency: "INR",
          content_ids: ["pt-car-2"],
          content_type: "product"
        },
        testEventCode
      }
    },
    {
      title: "TagActivated (what an activation sends)",
      event: {
        eventName: "TagActivated",
        eventId: activationEventId("verify-tag-0001"),
        actionSource: "app",
        userData: { phone: SAMPLE_PHONE },
        customData: { vehicle_type: "car" },
        testEventCode
      }
    }
  ];

  let failures = 0;

  for (const { title, event } of cases) {
    const result = await sendCapiEvent(env, event);

    console.log(title);
    line("event_id", event.eventId);
    line("result", result.ok ? "DELIVERED" : `FAILED — ${result.error}`);
    if (result.detail) line("detail", result.detail);
    console.log("");

    if (!result.ok) failures += 1;
  }

  if (failures) {
    console.error(`${failures} event(s) failed. Nothing reached Test events.\n`);
    process.exit(1);
  }

  console.log(
    "Both delivered. Open Events Manager → Test events and confirm:\n" +
      "  • Purchase      value 499 INR, event_id purchase:VERIFY-0001\n" +
      "  • TagActivated  vehicle_type car\n" +
      "  • both listed as Server, not Browser\n" +
      "\nA low match rate on these two is expected — the phone is a\n" +
      "documentation number belonging to nobody. What is being proved here is\n" +
      "that the payload arrives and is shaped correctly, not that it matches.\n"
  );
}

main().catch((error) => {
  console.error("\nverify failed:", error?.message || error, "\n");
  process.exit(1);
});
