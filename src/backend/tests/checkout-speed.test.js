// How long a buyer waits between "Continue to pay" and Razorpay's window.
//
// Measured on the live site on 1 Oct 2026: two to three seconds on /shop and
// five to six on /get. Almost none of it was Razorpay drawing its window. It
// was this app, doing things one after another that did not depend on each
// other, and doing some of them only at the tap that could have been done
// while the buyer was still typing:
//
//   - /get minted its bot-check token when the delivery step opened, and a
//     token lasts two minutes. An address takes longer to type, so at the tap
//     it was stale and a second one was fetched with the buyer watching.
//   - the server asked the courier about the pincode only at the tap, and
//     opened a brand-new TLS connection to Razorpay for every order.
//
// What is pinned here is each fix on its own. The order route's behaviour is
// held by the suites that already drive it (guest-checkout, guest-cod,
// quantity-checkout, referral-journey, guest-checkout-bot-gate).

import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import { JSDOM } from "jsdom";

import { startTestApp, stopTestApp, uniqueAddress, TEST_ORIGIN } from "./helpers.js";
import { keepFreshToken } from "../../frontend/scripts/fresh-captcha.js";
import { getRazorpay, warmRazorpay } from "../lib/integrations/payments.js";

const read = (path) => fs.readFileSync(new URL(`../../frontend/${path}`, import.meta.url), "utf8");

describe("the bot-check token is in hand at the tap", () => {
  // A hand-wound clock and timer, so two minutes of typing takes no time here.
  function harness() {
    let clock = 0;
    let tick = null;
    const minted = [];
    const mint = () => { minted.push(clock); return Promise.resolve(`token-${minted.length}`); };
    const keeper = keepFreshToken(mint, {
      now: () => clock,
      setTimer: (fn) => { tick = fn; return 1; },
      clearTimer: () => { tick = null; }
    });
    return {
      keeper, minted,
      // Let `seconds` pass, firing the refresh every 75 of them as the real timer would.
      wait(seconds) {
        for (let i = 0; i < seconds; i += 1) {
          clock += 1000;
          if (tick && clock % 75000 === 0) tick();
        }
      },
      ticking: () => tick !== null
    };
  }

  test("a buyer who pays quickly sends the token minted when the step opened", async () => {
    const h = harness();
    h.wait(40);
    assert.equal(await h.keeper.take(), "token-1");
    assert.equal(h.minted.length, 1, "nothing was minted at the tap");
  });

  test("a buyer who takes four minutes over the address still waits for nothing", async () => {
    const h = harness();
    h.wait(240);
    const mintedBeforeTap = h.minted.length;

    const token = await h.keeper.take();

    assert.equal(h.minted.length, mintedBeforeTap, "nothing was minted at the tap");
    assert.equal(token, `token-${mintedBeforeTap}`, "the newest one is the one sent");
    assert.ok(240000 - h.minted.at(-1) < 90000, "and it is inside the window Google accepts");
  });

  test("the old way, for comparison: one token at open is stale after two minutes", async () => {
    // What /get did before. Kept as a test so the reason for the timer stays visible.
    const h = harness();
    h.keeper.stop(); // no refreshing: only the token minted at open
    h.wait(240);
    const fresh = await h.keeper.take();
    assert.equal(fresh, "token-2", "a new one has to be minted at the tap, with the buyer waiting");
  });

  test("it stops calling Google once the token is taken, or the buyer backs out", async () => {
    const taken = harness();
    await taken.keeper.take();
    assert.equal(taken.ticking(), false);

    const backedOut = harness();
    backedOut.keeper.stop();
    backedOut.keeper.stop(); // twice is harmless
    assert.equal(backedOut.ticking(), false);
    backedOut.wait(300);
    assert.equal(backedOut.minted.length, 1);
  });

  test("a bot check that is off, or could not run, never blocks the order", async () => {
    const keeper = keepFreshToken(() => Promise.resolve(""), { setTimer: () => 1, clearTimer: () => {} });
    assert.equal(await keeper.take(), "");
  });

  test("a tab left in the background falls back to minting at the tap", async () => {
    // Browsers throttle timers in a background tab, so the refresh may not run.
    let clock = 0;
    let count = 0;
    const keeper = keepFreshToken(() => Promise.resolve(`token-${++count}`), {
      now: () => clock, setTimer: () => 1, clearTimer: () => {}
    });
    clock = 10 * 60 * 1000;
    assert.equal(await keeper.take(), "token-2");
  });

  test("/get uses it, and no longer keeps a single token from when the step opened", () => {
    const get = read("scripts/get.js");
    assert.match(get, /import \{ keepFreshToken \} from "\.\/fresh-captcha\.js";/);
    assert.match(get, /const captcha = keepFreshToken\(\(\) => getCaptchaToken\("guest_checkout"\)\);/);
    assert.match(get, /const recaptchaToken = await captcha\.take\(\);/);
    assert.doesNotMatch(get, /earlyCaptcha/);
    // Both ways out of the checkout before the tap stop the refreshing.
    assert.equal(get.match(/captcha\.stop\(\);/g).length, 2);
  });
});

describe("the connection to Razorpay is kept open, and opened early", () => {
  const env = { razorpayKeyId: "rzp_test_speed", razorpayKeySecret: "secret" };

  test("the client reuses connections", () => {
    const agent = getRazorpay(env).api.rq.defaults.httpsAgent;
    assert.ok(agent instanceof https.Agent);
    assert.equal(agent.keepAlive, true);
    assert.equal(getRazorpay(env).api.rq.defaults.httpsAgent, agent, "one agent, shared by every order");
  });

  test("warming it makes one read-only request, and creates nothing", () => {
    const calls = [];
    const rq = getRazorpay(env).api.rq;
    const realGet = rq.get;
    const realPost = rq.post;
    rq.get = (url, config) => { calls.push({ method: "GET", url, params: config.params }); return Promise.resolve({ status: 200 }); };
    rq.post = () => { throw new Error("warming must never write"); };
    try {
      assert.equal(warmRazorpay(env, { now: 1_000_000 }), true);
      assert.deepEqual(calls, [{ method: "GET", url: "/v1/orders", params: { count: 1 } }]);
    } finally {
      rq.get = realGet;
      rq.post = realPost;
    }
  });

  test("it is not repeated while the connection is certainly still open", () => {
    const rq = getRazorpay(env).api.rq;
    const realGet = rq.get;
    let count = 0;
    rq.get = () => { count += 1; return Promise.resolve({ status: 200 }); };
    try {
      assert.equal(warmRazorpay(env, { now: 2_000_000 }), true);
      assert.equal(warmRazorpay(env, { now: 2_005_000 }), false, "five seconds later: still warm");
      assert.equal(warmRazorpay(env, { now: 2_019_999 }), false);
      assert.equal(warmRazorpay(env, { now: 2_020_000 }), true, "twenty seconds later: again");
      assert.equal(count, 2);
    } finally {
      rq.get = realGet;
    }
  });

  test("a warm-up that fails is swallowed: the order opens its own connection", async () => {
    const rq = getRazorpay(env).api.rq;
    const realGet = rq.get;
    rq.get = () => Promise.reject(new Error("network down"));
    try {
      assert.equal(warmRazorpay(env, { now: 3_000_000 }), true);
      await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the run
    } finally {
      rq.get = realGet;
    }
  });

  test("with no Razorpay keys it does nothing", () => {
    assert.equal(warmRazorpay({ razorpayKeyId: "", razorpayKeySecret: "" }, { now: 4_000_000 }), false);
  });
});

describe("POST /api/shop/guest/warm", () => {
  let app;
  before(async () => { ({ app } = await startTestApp()); });
  after(async () => { await stopTestApp(app); });

  const warm = (payload, address = uniqueAddress()) => app.inject({
    method: "POST",
    url: "/api/shop/guest/warm",
    headers: { origin: TEST_ORIGIN },
    remoteAddress: address,
    payload
  });

  test("answers at once, with nothing in the body", async () => {
    const res = await warm({ pincode: "110052" });
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, "");
  });

  test("takes anything without complaint: it decides nothing, so there is nothing to probe", async () => {
    for (const payload of [{}, { pincode: "abc" }, { pincode: "000000" }, { pincode: 110052 }, { pincode: { $ne: null } }, { pincode: "1100520000" }]) {
      const res = await warm(payload);
      assert.equal(res.statusCode, 204, JSON.stringify(payload));
      assert.equal(res.body, "");
    }
  });

  test("is limited per address, like every other open endpoint", async () => {
    const address = uniqueAddress();
    let last;
    for (let i = 0; i < 21; i += 1) last = await warm({ pincode: "110052" }, address);
    assert.equal(last.statusCode, 429);
  });
});

describe("the delivery step tells the server when the buyer is close to paying", () => {
  const sheetSrc = read("scripts/owner/address-step.js");
  const open = [];
  after(() => open.forEach((w) => w.close()));

  function sheetWindow() {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://x.test/any", runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    open.push(w);
    w.warmed = [];
    w.fetch = async (input, opts) => {
      const u = String(input);
      if (u.includes("/api/shop/guest/warm")) w.warmed.push(JSON.parse(opts.body));
      if (u.includes("/api/owner/address")) return { ok: true, status: 200, json: async () => ({ ok: true, address: null }) };
      if (u.includes("/api/owner/dashboard")) return { ok: true, status: 200, json: async () => ({ ok: true, owner: { displayName: "" } }) };
      return { ok: false, status: 400, json: async () => ({ ok: false }) };
    };
    w.eval(sheetSrc);
    return w;
  }

  function type(w, key, value) {
    const input = w.document.getElementById(`pt-addr-${key}`);
    input.value = value;
    input.dispatchEvent(new w.Event(input.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }

  test("as soon as the pincode is complete, and with the pincode only", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true });
    type(w, "fullName", "Asha Verma");
    type(w, "phone", "9812345678");
    type(w, "pincode", "11005");
    assert.deepEqual(w.warmed, [], "not for a pincode that is still being typed");

    type(w, "pincode", "110052");
    assert.deepEqual(w.warmed, [{ pincode: "110052" }], "no name, no phone, no address");
  });

  test("not again for every keystroke after that", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true });
    type(w, "pincode", "110052");
    type(w, "fullName", "Asha Verma");
    type(w, "phone", "9812345678");
    type(w, "line1", "12B, MG Road");
    type(w, "city", "New Delhi");
    type(w, "state", "Delhi");
    assert.equal(w.warmed.length, 1, "the form became complete within the same twenty seconds");
  });

  test("again when the form is complete and the last warm-up has aged", () => {
    const w = sheetWindow();
    let clock = 1_000_000;
    w.Date.now = () => clock;
    w.ptCollectAddress({ guest: true });
    type(w, "pincode", "110052");
    type(w, "fullName", "Asha Verma");
    type(w, "phone", "9812345678");
    type(w, "line1", "12B, MG Road");
    type(w, "city", "New Delhi");
    assert.equal(w.warmed.length, 1);

    clock += 60_000; // a minute spent on the rest of the form
    type(w, "state", "Delhi"); // complete: the tap is close
    assert.equal(w.warmed.length, 2);
    assert.deepEqual(w.warmed[1], { pincode: "110052" });
  });

  test("a changed pincode is asked about straight away", () => {
    const w = sheetWindow();
    w.ptCollectAddress({ guest: true });
    type(w, "pincode", "110052");
    type(w, "pincode", "560001");
    assert.deepEqual(w.warmed, [{ pincode: "110052" }, { pincode: "560001" }]);
  });

  test("a signed-in owner's checkout is a different route and sends nothing here", async () => {
    const w = sheetWindow();
    w.ptCollectAddress();
    await new Promise((resolve) => setTimeout(resolve, 30));
    type(w, "pincode", "110052");
    assert.deepEqual(w.warmed, []);
  });

  test("a warm-up that cannot be sent does not disturb the form", () => {
    const w = sheetWindow();
    w.fetch = () => { throw new Error("blocked"); };
    w.ptCollectAddress({ guest: true });
    type(w, "pincode", "110052");
    assert.equal(w.document.getElementById("pt-addr-pincode").value, "110052");
  });
});

describe("/shop opens Razorpay's connections at the tap", () => {
  test("as /get already did", () => {
    const shop = read("scripts/shop.js");
    assert.match(shop, /preconnect\("https:\/\/checkout\.razorpay\.com"\);/);
    assert.match(shop, /if \(paymentMethod !== "cod"\) preconnect\("https:\/\/api\.razorpay\.com"\);/);
  });
});
