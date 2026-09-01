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

// What the token actually is, before asking what it can do.
//
// Every failure this script has produced so far has been a token problem
// wearing a pixel problem's error message: Meta answers "object does not exist,
// cannot be loaded due to missing permissions, or does not support this
// operation" for all of a wrong id, a token without rights to it, and a token
// with the wrong scopes entirely. Those need different fixes, and the message
// distinguishes none of them.
//
// Prints no secret: debug_token echoes the token's metadata, never the token.
async function diagnose() {
  const url = `https://graph.facebook.com/${"v19.0"}/debug_token?input_token=${env.metaCapiAccessToken}&access_token=${env.metaCapiAccessToken}`;
  const info = await fetch(url).then((r) => r.json()).catch(() => null);
  const data = info?.data;

  console.log("\nToken");
  if (!data) {
    console.log("  could not be inspected — it may be malformed or expired\n");
    return false;
  }

  const scopes = data.scopes || [];
  const expires = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : "never";

  line("type", data.type || "?");
  line("app", `${data.application || "?"} (${data.app_id || "?"})`);
  line("expires", expires);
  line("scopes", scopes.join(", ") || "(none)");

  // A Conversions API token needs rights over the dataset. A WhatsApp or
  // public-profile-only token is a perfectly valid token that simply cannot
  // write conversions, and that is the mistake worth naming out loud because
  // the Test events page links to the Graph API Explorer, which mints exactly
  // that kind of token.
  const canWriteEvents = scopes.some((s) => s === "ads_management" || s === "business_management");

  if (!canWriteEvents) {
    console.log(
      "\n  ✗ This token cannot write conversions.\n" +
        "    It has no ads_management / business_management scope.\n" +
        (scopes.some((s) => s.startsWith("whatsapp"))
          ? "    These are WhatsApp scopes — this is the token the Graph API\n" +
            "    Explorer button on the Test events page hands out.\n"
          : "") +
        "\n    Get the right one from:\n" +
        "      Events Manager → your pixel → Settings →\n" +
        "      Set up direct integration → Generate access token\n"
    );
    return false;
  }

  console.log("  ✓ has a scope that can write conversions\n");

  // Can it see the specific pixel it is about to post to?
  const pixel = await fetch(
    `https://graph.facebook.com/v19.0/${env.metaPixelId}?fields=id,name&access_token=${env.metaCapiAccessToken}`
  ).then((r) => r.json()).catch(() => null);

  if (pixel?.error) {
    console.log(
      `Pixel ${env.metaPixelId}\n` +
        `  ✗ not reachable with this token — ${pixel.error.message}\n\n` +
        "  Either META_PIXEL_ID is not this token's pixel, or the token was\n" +
        "  generated against a different dataset.\n"
    );
    return false;
  }

  console.log(`Pixel ${env.metaPixelId}\n  ✓ ${pixel?.name || "reachable"}\n`);
  return true;
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

  // Checked before sending, so a token problem is reported as a token problem
  // rather than as two identical and unhelpful 400s.
  const ready = await diagnose();
  if (!ready) {
    console.error("Stopping before sending: the problem above has to be fixed first.\n");
    process.exit(1);
  }

  console.log(`Sending to pixel ${env.metaPixelId}, test code ${testEventCode}\n`);

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
