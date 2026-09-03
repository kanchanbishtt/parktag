// Tests for the membership screen.
//
// The screen sells something, so the numbers on it are the thing worth pinning:
// a price the browser could author, a saving that stopped being true when a
// price moved, or a trial length that says 45 days after the window was widened
// to 90 are all defects that look like copy.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

// A throwaway pair, set before anything reads the environment — sibling test
// files delete these same global vars (checkout-pricing, shop-idempotency),
// so this file cannot rely on them being ambient. Without it,
// isRazorpayConfigured(env) reads false here, which is why checkoutEnabled
// silently drops out and verify-payment's "not configured" branch (500) fires
// ahead of the 400 the unsigned-signature test expects.
process.env.RAZORPAY_KEY_ID = "rzp_test_ci_placeholder";
process.env.RAZORPAY_KEY_SECRET = "ci_placeholder_secret";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";
import {
  DOCS_PER_SUBSCRIBED_TAG,
  PREMIUM_TRIAL_LABEL,
  PREMIUM_TRIAL_MONTHS,
  premiumTrialLengthDays
} from "../lib/core/vault.js";
import { membershipPlans, membershipFeatures } from "../lib/core/membership-plans.js";

// Twelve calendar months is 365 days or 366 depending on where the year
// falls, so the window's length is measured off the same helper the
// entitlement uses rather than written down as a number here.
const TRIAL_DAYS = premiumTrialLengthDays();

const EMAIL = "membership-owner@parktag-test.invalid";
const PASSWORD = "membership-fixture-password-3b71";

let app;
let collections;
let cookie;

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await createTestOwner(collections, { email: EMAIL, password: PASSWORD });
  await clearLoginLock(collections, EMAIL);

  const login = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { identifier: EMAIL, pin: PASSWORD }
  });
  assert.equal(login.statusCode, 200, `fixture sign-in failed: ${login.body}`);

  const jar = login.cookies.find((c) => c.name === "wavetag_session");
  cookie = `wavetag_session=${jar.value}`;
});

after(async () => {
  await collections.owners.deleteMany({ email: EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function get(url, withCookie = true) {
  return app.inject({
    method: "GET",
    url,
    remoteAddress: uniqueAddress(),
    headers: withCookie ? { cookie } : {}
  });
}

describe("the membership catalogue", () => {
  test("it is not served without a session", async () => {
    const api = await get("/api/owner/membership", false);
    assert.equal(api.statusCode, 401);

    const page = await get("/owner-membership", false);
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, "/owner-login");
  });

  // The dashboard once carried a hardcoded 45-day trial that stayed wrong for a
  // whole release after the window was widened, and the membership capsule then
  // hard-coded the word DAYS in its markup. Every part of the banner is derived.
  test("the trial banner tracks the configured window", async () => {
    const body = (await get("/api/owner/membership")).json();

    assert.equal(body.trial.months, PREMIUM_TRIAL_MONTHS);
    assert.equal(body.trial.headline, PREMIUM_TRIAL_LABEL);
    // The capsule stacks these two; together they must read as the headline.
    assert.equal(`${body.trial.value} ${body.trial.unit}`.toLowerCase(), PREMIUM_TRIAL_LABEL.toLowerCase());
    // The unit has to travel with the number. A hard-coded "DAYS" beside a
    // "1" is exactly the bug this replaced.
    assert.equal(body.trial.unit, "YEAR");
  });

  // A saving typed in beside a price is a claim that silently becomes false the
  // first time either number moves.
  test("every advertised saving is arithmetically true", async () => {
    const { plans } = (await get("/api/owner/membership")).json();
    const monthly = plans.find((p) => p.months === 1);

    assert.ok(monthly, "there is no monthly plan to price the others against");

    for (const plan of plans) {
      const undiscounted = monthly.priceInr * plan.months;
      const expected =
        undiscounted <= plan.priceInr
          ? 0
          : Math.round(((undiscounted - plan.priceInr) / undiscounted) * 100);

      assert.equal(
        plan.savingPercent,
        expected,
        `${plan.label} claims ${plan.savingPercent}% off ₹${undiscounted} at ₹${plan.priceInr}`
      );
      assert.ok(plan.priceInr > 0, `${plan.label} has no price`);
    }
  });

  test("exactly one plan is flagged popular", async () => {
    const { plans } = (await get("/api/owner/membership")).json();
    assert.equal(plans.filter((p) => p.popular).length, 1);
  });

  // Every tile is something the product actually does, and the numbers come
  // from the entitlement constants rather than being written out again.
  test("the feature grid quotes the real document allowance", async () => {
    const { features } = (await get("/api/owner/membership")).json();
    const docs = features.find((f) => f.id === "documents");

    assert.ok(docs, "the document allowance is not listed");
    // includes(), not a RegExp built in a template literal: `` there is the
    // backspace character, not a word boundary, so the assertion silently
    // stopped testing the thing it is named after.
    assert.ok(
      docs.label.includes(String(DOCS_PER_SUBSCRIBED_TAG)),
      `the document tile reads "${docs.label}" but the allowance is ${DOCS_PER_SUBSCRIBED_TAG}`
    );
  });

  // Replaces two tests about the tag-type selector, which is gone: it had three
  // positions and one useful answer, so the grid is simply what a membership
  // buys. What still needs pinning is that the list is renderable.
  test("every feature is renderable and distinct", async () => {
    const { features } = (await get("/api/owner/membership")).json();

    assert.ok(features.length > 0, "the grid would render empty");

    for (const feature of features) {
      assert.ok(feature.id, "a feature has no id");
      assert.ok(feature.label && feature.label.trim(), `${feature.id} has no label`);
      assert.ok(feature.icon, `${feature.id} has no icon key`);
      assert.equal(feature.scopes, undefined, `${feature.id} still carries a tag-type scope`);
    }
  });

  // The selector is gone from the payload as well as the page, so a stale
  // client cannot resurrect a filter the server no longer describes.
  test("the payload no longer advertises tag types", async () => {
    const body = (await get("/api/owner/membership")).json();
    assert.equal(body.scopes, undefined);
  });

  // The flag tracks whether Razorpay is configured, not whether the feature
  // exists — an environment with no keys shows the page and says why instead of
  // opening a sheet that cannot complete. The test app configures them.
  test("checkout opens when Razorpay is configured", async () => {
    const body = (await get("/api/owner/membership")).json();
    assert.equal(body.checkoutEnabled, true);
  });

  test("the page satisfies the tightened policy it is served with", async () => {
    const response = await get("/owner-membership");
    assert.equal(response.statusCode, 200);

    const csp = response.headers["content-security-policy"] || "";
    const directive = (name) =>
      csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

    // No inline script, and no inline handlers either — this page builds
    // nothing with onclick, so it keeps script-src-attr 'none' even though it
    // now takes a payment. That makes it stricter than /owner-welcome, which
    // does need inline handlers.
    assert.ok(!directive("script-src").includes("'unsafe-inline'"));
    assert.match(csp, /script-src-attr 'none'/);

    // Razorpay's checkout.js has to be reachable or the button does nothing.
    // This is the directive that decides it, and it is the reason the page
    // moved off STRICT_SCRIPT_PAGES: that list's script-src has no payment
    // origin in it, deliberately, because the login and password-reset pages
    // are on it too.
    assert.ok(
      directive("script-src").includes("https://checkout.razorpay.com"),
      `checkout.js is blocked by script-src: ${directive("script-src")}`
    );
    assert.match(csp, /frame-src[^;]*razorpay/, "the payment sheet's iframe is blocked");

    // style-src keeps 'unsafe-inline' here, unlike the strict pages. checkout.js
    // injects a <style> for its overlay and blocking it leaves the payment sheet
    // rendering wrong — the same reason /owner-welcome keeps it.
    assert.ok(directive("style-src").includes("'unsafe-inline'"));

    // The stylesheet stays external regardless. It was extracted because the
    // strict policy dropped inline styles, and that reason has gone, but a
    // stylesheet the browser can cache for a year beats one re-sent with every
    // page — and it keeps this page honest if it is ever tightened again.
    assert.ok(
      !/<style[^>]*>/i.test(response.body),
      "the screen's CSS belongs in the cacheable stylesheet, not the page"
    );
    assert.ok(!/\son(click|input|change|submit)\s*=/i.test(response.body));
    assert.match(response.headers["cache-control"] || "", /no-store/);

    const css = await get("/styles/owner-membership.css", false);
    assert.equal(css.statusCode, 200, "the stylesheet is not served");
  });

  // The other strict pages must NOT have gained a payment origin when this one
  // did. They take no payments, and the whole reason /owner-membership got its
  // own policy instead of checkout.razorpay.com being added to
  // STRICT_SCRIPT_SOURCES was to keep it off the credential pages.
  test("the login pages did not inherit the payment origin", async () => {
    for (const path of ["/owner-login", "/owner-verify", "/register-owner"]) {
      const csp = (await get(path, false)).headers["content-security-policy"] || "";
      assert.ok(
        !csp.includes("checkout.razorpay.com"),
        `${path} can load Razorpay's checkout and has no reason to`
      );
    }
  });

  // The screen is reached from the profile tab, and a card whose button goes
  // nowhere is the failure this catches.
  test("the profile card links to it", async () => {
    const page = await get("/owner-welcome");
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /href="\/owner-membership"/);
  });
});

describe("the loading state", () => {
  // The skeleton must be in the MARKUP the server sends. membership.js is
  // type="module" and therefore deferred, so anything it injects arrives after
  // the parser has painted — a skeleton built in JavaScript is a skeleton
  // nobody sees, and the empty shell it was meant to replace is what ships.
  test("the placeholders are served with the page, not injected later", async () => {
    const body = (await get("/owner-membership")).body;

    assert.equal((body.match(/mb-sk-plan/g) || []).length, 3, "plan placeholders missing");
    // Matched on the unique placeholder class rather than on the attribute
    // starting with it: the number also carries a sizing class, and which is
    // written first is not what this asserts.
    assert.match(body, /id="mbTrialDays"[^>]*mb-sk-days/, "the trial number has no placeholder");
  });

  // A skeleton of the wrong length is still a layout shift, just an earlier
  // one: the tiles would appear and shove everything below them down the page.
  test("the tile count matches what the grid renders", async () => {
    const body = (await get("/owner-membership")).body;
    const { features } = (await get("/api/owner/membership")).json();

    const rendered = features.length;
    const placeholders = (body.match(/mb-sk-feat/g) || []).length;

    assert.equal(
      placeholders,
      rendered,
      `${placeholders} placeholders for ${rendered} tiles — the grid will jump when it fills`
    );
  });

  test("the shimmer is dropped for anyone who asks for reduced motion", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body;

    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    const guarded = css.split("prefers-reduced-motion")[1] || "";
    assert.match(guarded, /animation:\s*none/, "the guard does not actually stop the animation");
  });
});

describe("pricing is legible on the card", () => {
  // Without a per-month rate, ₹249 sits beside ₹49 reading as five times the
  // price, and the annual plan — the best value on the row — looks like the
  // most expensive thing on the screen.
  test("every plan reports what it works out to per month", async () => {
    const { plans } = (await get("/api/owner/membership")).json();

    for (const plan of plans) {
      const exact = plan.priceInr / plan.months;

      assert.equal(plan.perMonthInr, Math.round(exact), `${plan.label} rate is wrong`);
      assert.equal(
        plan.perMonthExact,
        plan.perMonthInr === exact,
        `${plan.label} misreports whether its rate is exact`
      );
    }
  });

  // ₹149 over six months is ₹24.83. Printing a flat "₹25/mo" would advertise a
  // price we do not charge, so the flag is what earns the approximate sign.
  test("a rate that does not divide evenly is flagged approximate", async () => {
    const { plans } = (await get("/api/owner/membership")).json();

    const monthly = plans.find((p) => p.months === 1);
    assert.equal(monthly.perMonthExact, true, "the monthly plan must be exact");

    const uneven = plans.filter((p) => (p.priceInr / p.months) % 1 !== 0);
    for (const plan of uneven) {
      assert.equal(plan.perMonthExact, false, `${plan.label} claims an exact rate it does not have`);
    }
  });
});

describe("the look", () => {
  // The star the page is titled with. It was a bookmark glyph, and gold is the
  // one place on the screen that colour is allowed to appear.
  test("the title carries a gold star", async () => {
    const body = (await get("/owner-membership")).body;
    const css = (await get("/styles/owner-membership.css", false)).body;

    assert.match(body, /class="mb-title-ic"/, "the title has no icon");
    assert.match(css, /--gold:\s*#FFC02E/i, "gold is not a named token");
    assert.match(
      css.replace(/\/\*[\s\S]*?\*\//g, ""),
      /\.mb-title-ic\s*\{[^}]*color:\s*var\(--gold\)/,
      "the star does not use the gold token"
    );
  });

  // The plan row is navy now: navy edge on every card, a light navy fill and a
  // navy lift on the one that is chosen. Red still belongs to the page — the
  // trial tile, the heading rules, the Go Pro button — but not here, where it
  // used to fill the selected card solid.
  test("no red survives on the plan cards", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body.replace(/\/\*[\s\S]*?\*\//g, "");

    // Only the rules for the cards themselves. Scanning the whole stylesheet
    // would flag the trial tile and the CTA, which are supposed to be red, and
    // report the brand as the fault.
    const cardRules = (css.match(/^[ \t]*\.mb-plan[^{]*\{[^}]*\}/gm) || []).join("\n");
    assert.ok(cardRules.length > 0, "no .mb-plan rules found — the scan is looking at nothing");

    const isRed = (r, g, b) => r > 150 && g < 110 && b < 110;
    const reds = [];

    for (const hex of cardRules.match(/#[0-9a-fA-F]{6}/g) || []) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      if (isRed(r, g, b)) reds.push(hex);
    }
    // rgba() as well as hex: the fill was var(--amber) but the glow under it was
    // written out longhand as rgba(255, 39, 0, .32), and a hex-only scan would
    // have called that clean.
    for (const fn of cardRules.match(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/g) || []) {
      const [r, g, b] = fn.match(/\d+/g).map(Number);
      if (isRed(r, g, b)) reds.push(fn + ", ...)");
    }
    // var(--amber) resolves to red without ever spelling one out.
    if (/var\(--amber\b/.test(cardRules)) reds.push("var(--amber)");

    // Prove all three arms bite, or a clean result means nothing.
    const canary = `.mb-plan { background: #FF2700; box-shadow: 0 9px 24px rgba(255, 39, 0, .32); border-color: var(--amber); }`;
    const canaryHits = [
      /#FF2700/.test(canary),
      /rgba\(\s*255\s*,\s*39\s*,\s*0/.test(canary),
      /var\(--amber\b/.test(canary)
    ];
    assert.deepEqual(canaryHits, [true, true, true], "the red detector does not recognise the red it replaced");

    assert.deepEqual(reds, [], `red on the plan cards: ${reds.join(", ")}`);

    // And the things that replaced it are actually there.
    assert.match(cardRules, /border:\s*1\.5px solid var\(--navy\)/, "the cards have no navy edge");
    assert.match(cardRules, /background:\s*var\(--navy-tint\)/, "the chosen card has no light navy fill");
  });

  // A card you can tab to has to show where you are. The selected card needs it
  // most: without a rule of its own its ring loses to the selected shadow, and
  // keyboard users lose their place on the one card already chosen.
  test("the plan cards show a focus ring, selected or not", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body.replace(/\/\*[\s\S]*?\*\//g, "");

    assert.match(css, /\.mb-plan:focus-visible\s*\{[^}]*box-shadow/, "no focus ring on a plan card");
    assert.match(
      css,
      /\.mb-plan\[aria-checked="true"\]:focus-visible\s*\{[^}]*box-shadow/,
      "the selected card's focus ring is missing, so it is beaten by the selected shadow"
    );
    // A bare :hover would stay lit on the last card tapped on a phone.
    assert.match(css, /@media \(hover: hover\)/, "hover styling is not guarded for touch devices");
  });

  // Gold on the star is deliberate. Gold anywhere else would put the page back
  // in the reference's colour scheme, which is the one thing it must not be.
  test("no other yellow reaches the stylesheet", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body;
    const declarations = css.replace(/\/\*[\s\S]*?\*\//g, "");

    const isYellow = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return r > 180 && g > 150 && b < 120;
    };

    // Prove the detector bites before trusting it to pass. A version of this
    // check once carried a stray control character in its pattern, matched
    // nothing ever, and reported a clean sheet on a stylesheet full of colour.
    assert.ok(
      ["#FFD400", "#EAB308", "#FACC15"].every(isYellow),
      "the yellow detector does not recognise yellow, so it proves nothing"
    );

    const strays = (declarations.match(/#[0-9a-fA-F]{6}/g) || [])
      .filter(isYellow)
      .filter((hex) => hex.toLowerCase() !== "#ffc02e");

    assert.deepEqual(strays, [], `yellow outside the star token: ${strays.join(", ")}`);
  });
});

describe("the layout holds together at every width", () => {
  // A brace-depth walk, because a media block contains braces and a regex for
  // "a block" stops at the first one it meets.
  const blocks = (src) => {
    const out = [];
    let depth = 0;
    let start = 0;
    let head = "";
    let open = 0;

    for (let i = 0; i < src.length; i += 1) {
      if (src[i] === "{") {
        if (depth === 0) {
          head = src.slice(start, i).trim();
          open = i;
        }
        depth += 1;
      } else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          out.push({ head, body: src.slice(open + 1, i), at: start });
          start = i + 1;
        }
      }
    }

    return out;
  };

  // Every selector a media block touches must have its base rule EARLIER in the
  // file. A media query adds no specificity, so a breakpoint written above the
  // rules it overrides loses to them and does nothing at all — no warning, no
  // error, just a layout that never changes. This page shipped one (a
  // max-width: 350px block sitting above half the styles it named) and so did
  // the dashboard, whose shop grid stayed two columns at every width for a
  // release. Both were found by eye. This finds the next one.
  const deadOverrides = (css) => {
    const all = blocks(css.replace(/\/\*[\s\S]*?\*\//g, ""));
    const plain = all.filter((b) => !b.head.startsWith("@"));
    const dead = [];

    for (const media of all.filter((b) => b.head.startsWith("@media"))) {
      for (const inner of blocks(media.body)) {
        // Custom properties inherit, so a :root override inside a media block
        // is the intended pattern rather than a mistake.
        if (inner.head.startsWith(":root")) continue;

        const base = plain.filter((p) => p.head === inner.head);
        if (base.length && base[base.length - 1].at > media.at) dead.push(inner.head);
      }
    }

    return [...new Set(dead)];
  };

  test("no breakpoint is dead", async () => {
    // Prove the detector bites first. A checker that cannot fail is a passing
    // test that means nothing, which this suite has been caught shipping.
    assert.deepEqual(
      deadOverrides("@media (max-width: 400px) { .a { color: red; } }\n.a { color: blue; }"),
      [".a"],
      "the detector does not recognise a media block placed above its base rule"
    );

    const css = (await get("/styles/owner-membership.css", false)).body;
    assert.deepEqual(
      deadOverrides(css),
      [],
      "a breakpoint sits above the rules it overrides and therefore does nothing"
    );
  });

  // The content column, the header row and the fixed action button are three
  // separate boxes that have to share a left and right edge. The button used to
  // carry a literal 692px — which is 720 - 14 * 2, correct only while the
  // gutter was 14px and silently 14px off the column once it was not.
  test("the action button is derived from the column, not a copy of it", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body.replace(/\/\*[\s\S]*?\*\//g, "");

    assert.ok(!/692px/.test(css), "the button still carries a hardcoded width");
    assert.match(
      css,
      /max-width:\s*calc\(var\(--wrap\) - var\(--gutter\) \* 2\)/,
      "the button width is not derived from the column tokens"
    );
    assert.match(
      css,
      /\.mb-wrap\s*\{[^}]*max-width:\s*var\(--wrap\)/,
      "the column does not use the token the button is measured against"
    );
  });

  // A section break has to be visibly bigger than the gaps inside a section, at
  // every breakpoint, or it stops reading as a break. These were 20px and 18px,
  // and the free-trial card floated between the hero above it and the plans
  // below with nothing to say which it belonged to.
  test("section gaps stay larger than block gaps at every breakpoint", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body.replace(/\/\*[\s\S]*?\*\//g, "");
    const px = (body, name) => {
      const m = body.match(new RegExp(`--${name}:\\s*(\\d+)px`));
      return m ? Number(m[1]) : null;
    };

    const all = blocks(css);
    const root = all.find((b) => b.head === ":root");
    assert.ok(root, "the layout tokens are not declared on :root");

    const base = { sec: px(root.body, "space-sec"), blk: px(root.body, "space-blk") };
    assert.ok(base.sec && base.blk, "the rhythm is not tokenised");

    const scopes = [{ name: "base", ...base }];
    for (const media of all.filter((b) => b.head.startsWith("@media"))) {
      const inner = blocks(media.body).find((b) => b.head === ":root");
      if (!inner) continue;
      scopes.push({
        name: media.head,
        sec: px(inner.body, "space-sec") ?? base.sec,
        blk: px(inner.body, "space-blk") ?? base.blk
      });
    }

    assert.ok(scopes.length >= 4, `only ${scopes.length} layout scopes — that is not a ladder`);

    for (const scope of scopes) {
      assert.ok(
        scope.sec > scope.blk,
        `${scope.name} spaces sections at ${scope.sec}px and blocks at ${scope.blk}px, so there is no break`
      );
    }
  });

  // A placeholder of the wrong size is a layout shift, only an earlier one. The
  // cards resize at two breakpoints; the shimmer standing in for them has to
  // resize in the same block.
  test("the skeleton tracks the cards it stands in for", async () => {
    const css = (await get("/styles/owner-membership.css", false)).body.replace(/\/\*[\s\S]*?\*\//g, "");
    const all = blocks(css);
    const heightOf = (body, sel) => {
      const m = body.match(new RegExp(`\\${sel}\\s*\\{[^}]*min-height:\\s*(\\d+)px`));
      return m ? Number(m[1]) : null;
    };

    const scopes = [
      {
        name: "base",
        body: all.filter((b) => !b.head.startsWith("@")).map((b) => `${b.head}{${b.body}}`).join("\n")
      },
      ...all.filter((b) => b.head.startsWith("@media")).map((b) => ({ name: b.head, body: b.body }))
    ];

    let sized = 0;
    for (const scope of scopes) {
      const card = heightOf(scope.body, ".mb-plan");
      const skeleton = heightOf(scope.body, ".mb-sk-plan");
      if (card === null && skeleton === null) continue;
      sized += 1;
      assert.equal(
        skeleton,
        card,
        `${scope.name} sizes the plan card at ${card}px and its placeholder at ${skeleton}px`
      );
    }

    assert.ok(sized >= 2, "no breakpoint resizes the cards, so this proves nothing");
  });
});


// Nothing the browser says about money is trusted.
//
// The checkout is necessarily split: Razorpay's sheet runs in the buyer's
// browser, because that is what keeps card details off this server entirely.
// Everything that decides an AMOUNT or an ENTITLEMENT is on this side, and
// these tests are what keep it that way — a change that starts reading a price
// out of the request body fails here rather than in production.
describe("the client cannot decide what it pays", () => {
  let buyerId;
  let tagId;

  before(async () => {
    const owner = await collections.owners.findOne({ email: EMAIL });
    buyerId = owner._id;

    // A membership attaches to a tag, so the buyer needs one.
    const tag = await collections.tags.insertOne({
      ownerId: buyerId,
      plateNumber: "QA01MEM0001",
      vehicleType: "car",
      status: "active",
      premium: false,
      token: "qa-membership-checkout",
      createdAt: new Date().toISOString()
    });
    tagId = tag.insertedId;
  });

  after(async () => {
    await collections.tags.deleteMany({ token: "qa-membership-checkout" });
    await collections.membershipOrders.deleteMany({ ownerId: buyerId });
  });

  function post(url, payload) {
    return app.inject({
      method: "POST",
      url,
      remoteAddress: uniqueAddress(),
      headers: { cookie, origin: TEST_ORIGIN, "content-type": "application/json" },
      payload
    });
  }

  // The row create-order would have written, seeded directly.
  //
  // Never by calling create-order itself: the credentials in this environment
  // are live test-mode keys, so minting would leave real abandoned orders in
  // the Razorpay account on every run. shop-idempotency.test.js solves the same
  // problem by deleting the key; that is not available here, because verifying
  // a signature needs the secret. Seeding the row exercises the reuse path
  // instead, which is the branch that returns before any API call.
  async function seedOrder(planId, amountPaise, months) {
    const orderId = `order_QA_MEM_${planId}_${Date.now()}`;
    await collections.membershipOrders.insertOne({
      orderId,
      ownerId: buyerId,
      tagId,
      planId,
      months,
      amount: amountPaise,
      currency: "INR",
      status: "created",
      createdAt: new Date().toISOString()
    });
    return orderId;
  }

  // The whole point. A body carrying its own price must not change the order.
  test("an amount in the request body is ignored", async () => {
    const orderId = await seedOrder("m12", 24900, 12);

    const tampered = await post("/api/owner/membership/create-order", {
      planId: "m12",
      amount: 100,
      amountPaise: 100,
      priceInr: 1,
      months: 999,
      currency: "USD"
    });

    assert.equal(tampered.statusCode, 200, tampered.body);
    // It is handed back the seeded order — proof it never reached the minting
    // branch — and at the catalogue figure, not the one the body asked for.
    assert.equal(tampered.json().orderId, orderId);
    assert.equal(tampered.json().amount, 24900, "the browser set its own price");
    assert.equal(tampered.json().currency, "INR");

    const stored = await collections.membershipOrders.findOne({ orderId });
    assert.equal(stored.amount, 24900, "the stored amount is not the catalogue price");
    assert.equal(stored.months, 12, "months came from the request rather than the plan");
    assert.equal(String(stored.ownerId), String(buyerId), "the order is not bound to its buyer");
  });

  test("an unknown plan is refused rather than priced at whatever was sent", async () => {
    const response = await post("/api/owner/membership/create-order", {
      planId: "m999",
      amount: 100
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /Unknown plan/);
  });

  // The public key id is required by checkout.js and is visible in any network
  // tab. The key secret signs orders and verifies payments and must never leave
  // this process.
  test("only the public key id is sent to the browser", async () => {
    await seedOrder("m1", 4900, 1);
    const response = await post("/api/owner/membership/create-order", { planId: "m1" });

    assert.equal(response.statusCode, 200, response.body);
    assert.match(response.body, /"keyId"/, "checkout.js cannot open without the public key id");
    assert.ok(
      !response.body.includes(process.env.RAZORPAY_KEY_SECRET || "__never_set__"),
      "the key secret was serialised to the client"
    );
  });

  // A payment report has to be signed with the key secret. Without it anyone
  // logged in could claim any order was paid and grant themselves a year.
  test("an unsigned payment claim grants nothing", async () => {
    const orderId = await seedOrder("m6", 14900, 6);

    const response = await post("/api/owner/membership/verify-payment", {
      razorpay_order_id: orderId,
      razorpay_payment_id: "pay_made_up",
      razorpay_signature: "0".repeat(64)
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /verification failed/i);

    const stored = await collections.membershipOrders.findOne({ orderId });
    assert.equal(stored.status, "created", "an unsigned claim marked the order paid");

    const tag = await collections.tags.findOne({ _id: tagId });
    assert.equal(tag.subscription, undefined, "an unsigned claim granted a subscription");
  });
});

describe("the plan module", () => {
  test("plan ids are unique, so a selection cannot be ambiguous", () => {
    const ids = membershipPlans().map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("feature ids are unique", () => {
    const ids = membershipFeatures().map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
