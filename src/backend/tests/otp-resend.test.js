// Tapping "Resend code" has to put a real message on the wire.
//
// It did not. The server reused any unused code from the last TWO MINUTES and
// returned { ok: true } without dispatching anything, while the activation
// wizard re-enabled its Resend button after THIRTY SECONDS
// (startResendCooldown in scanner/app.js). For the ninety seconds in between,
// every press was answered with "New code sent on WhatsApp." and sent nothing —
// so someone who never received the first code could ask three times, be told
// it worked three times, and still be holding nothing. Tag activation cannot
// complete without that code, so the tag was simply unactivatable until the
// person walked away for two minutes.
//
// These tests are written against the boundary that actually broke — the UI's
// cooldown — rather than against the internal constant. If someone lengthens
// the reuse window past the cooldown again, or shortens the cooldown below the
// window, this fails. That pairing is the bug; either half alone is fine.
//
// The identifier is an e-mail on purpose. The reuse check runs before the
// channel is chosen, so it exercises the same code path a phone number does,
// and the e-mail sender is fire-and-forget at an address that cannot resolve.
// Nothing is dispatched anywhere by this file.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  purgeLoginCollections,
  assertUndeliverableIdentifier
} from "./helpers.js";
import { sendOtp } from "../lib/auth/otp.js";

// Mirrors startResendCooldown(seconds = 30) in src/frontend/scripts/scanner/app.js.
const UI_RESEND_COOLDOWN_MS = 30 * 1000;

const EMAIL = "qa-otp-resend@parktag-test.invalid";

let app;
let collections;
let env;

before(async () => {
  ({ app, collections, env } = await startTestApp());
  assertUndeliverableIdentifier(EMAIL);
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

const countTokens = () => collections.otpTokens.countDocuments({ identifier: EMAIL });

// Rather than sleeping through the window, age the codes already issued. The
// reuse check reads createdAt, so backdating every existing token is the same
// thing to it as time having passed, and the test stays deterministic.
async function ageCodesBy(ms) {
  const tokens = await collections.otpTokens.find({ identifier: EMAIL }).toArray();
  for (const token of tokens) {
    await collections.otpTokens.updateOne(
      { _id: token._id },
      { $set: { createdAt: new Date(Date.parse(token.createdAt) - ms).toISOString() } }
    );
  }
}

describe("resending a verification code", () => {
  test("a press the UI allows always dispatches a new code", async () => {
    await collections.otpTokens.deleteMany({ identifier: EMAIL });

    await sendOtp(env, EMAIL);
    assert.equal(await countTokens(), 1, "the first request sent nothing");

    // The moment the button becomes pressable again, and not a second later.
    await ageCodesBy(UI_RESEND_COOLDOWN_MS);
    await sendOtp(env, EMAIL);

    assert.equal(
      await countTokens(),
      2,
      "Resend was answered without sending: the reuse window outlasts the UI cooldown again, " +
        "so the button is live during a period when pressing it does nothing"
    );
  });

  test("an accidental double-submit is still swallowed", async () => {
    await collections.otpTokens.deleteMany({ identifier: EMAIL });

    // Two requests back to back, as a double tap or a retried request produces.
    await sendOtp(env, EMAIL);
    await sendOtp(env, EMAIL);

    assert.equal(
      await countTokens(),
      1,
      "an immediate repeat sent a second message; the duplicate-submit guard is gone"
    );
  });

  test("the per-destination ceiling still holds, and now counts real sends", async () => {
    await collections.otpTokens.deleteMany({ identifier: EMAIL });

    // Five is MAX_SENDS_PER_WINDOW. Each pass ages what exists so the request
    // is a genuine resend rather than a duplicate submit.
    for (let i = 0; i < 5; i += 1) {
      await sendOtp(env, EMAIL);
      await ageCodesBy(UI_RESEND_COOLDOWN_MS);
    }
    assert.equal(await countTokens(), 5, "the five permitted sends did not all dispatch");

    await assert.rejects(
      () => sendOtp(env, EMAIL),
      /Too many verification codes/i,
      "the sixth send was allowed; shortening the reuse window widened the flood cap"
    );
    assert.equal(await countTokens(), 5, "the refused send still issued a code");
  });
});
