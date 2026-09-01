// Tests for the membership screen.
//
// The screen sells something, so the numbers on it are the thing worth pinning:
// a price the browser could author, a saving that stopped being true when a
// price moved, or a trial length that says 45 days after the window was widened
// to 90 are all defects that look like copy.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import {
  startTestApp,
  stopTestApp,
  createTestOwner,
  purgeLoginCollections,
  clearLoginLock,
  uniqueAddress,
  TEST_ORIGIN
} from "./helpers.js";
import { PREMIUM_TRIAL_DAYS, DOCS_PER_SUBSCRIBED_TAG } from "../lib/core/vault.js";
import { membershipPlans, membershipFeatures } from "../lib/core/membership-plans.js";

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
  // whole release after the window was widened. The banner reads the constant.
  test("the trial banner tracks PREMIUM_TRIAL_DAYS", async () => {
    const body = (await get("/api/owner/membership")).json();

    assert.equal(body.trial.days, PREMIUM_TRIAL_DAYS);
    assert.equal(body.trial.headline, `${PREMIUM_TRIAL_DAYS} Days`);
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

  test("every feature belongs to at least one tag type", async () => {
    const { features, scopes } = (await get("/api/owner/membership")).json();
    const known = new Set(scopes.map((s) => s.id));

    for (const feature of features) {
      assert.ok(feature.scopes.length > 0, `${feature.id} is shown for no tag type`);
      for (const scope of feature.scopes) {
        assert.ok(known.has(scope), `${feature.id} names an unknown tag type: ${scope}`);
      }
    }
  });

  test("every tag type has features to show", async () => {
    const { features, scopes } = (await get("/api/owner/membership")).json();

    for (const scope of scopes) {
      const shown = features.filter((f) => f.scopes.includes(scope.id));
      assert.ok(shown.length > 0, `${scope.label} would render an empty grid`);
    }
  });

  // There is no membership SKU in SHOP_PRODUCTS and no recurring-billing path.
  // The flag is what stops the page opening a checkout that cannot complete;
  // when one is built, flipping it is the switch.
  test("checkout stays closed until a membership product exists", async () => {
    const body = (await get("/api/owner/membership")).json();
    assert.equal(body.checkoutEnabled, false);
  });

  test("the page satisfies the tightened policy it is served with", async () => {
    const response = await get("/owner-membership");
    assert.equal(response.statusCode, 200);

    const csp = response.headers["content-security-policy"] || "";
    const directive = (name) =>
      csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));

    assert.ok(!directive("script-src").includes("'unsafe-inline'"));
    assert.ok(!directive("style-src").includes("'unsafe-inline'"));
    assert.match(csp, /style-src-attr 'unsafe-inline'/);

    assert.ok(
      !/<style[^>]*>/i.test(response.body),
      "an inline <style> here is dropped silently and the screen renders unstyled"
    );
    assert.ok(!/\son(click|input|change|submit)\s*=/i.test(response.body));
    assert.match(response.headers["cache-control"] || "", /no-store/);

    const css = await get("/styles/owner-membership.css", false);
    assert.equal(css.statusCode, 200, "the stylesheet is not served");
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
    assert.equal((body.match(/mb-sk-pill/g) || []).length, 3, "tag-type placeholders missing");
    // Matched on the unique placeholder class rather than on the attribute
    // starting with it: the number also carries a sizing class, and which is
    // written first is not what this asserts.
    assert.match(body, /id="mbTrialDays"[^>]*mb-sk-days/, "the trial number has no placeholder");
  });

  // A skeleton of the wrong length is still a layout shift, just an earlier
  // one: the tiles would appear and shove everything below them down the page.
  test("the tile count matches what the default tag type renders", async () => {
    const body = (await get("/owner-membership")).body;
    const { features, scopes } = (await get("/api/owner/membership")).json();

    const defaultScope = scopes[0].id;
    const rendered = features.filter((f) => f.scopes.includes(defaultScope)).length;
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
