// The Play Store app: a Trusted Web Activity showing the owner pages.
//
// Two things on the site side make it work and keep it within Play's rules.
// Android shows the app without a browser bar only when the site publishes a
// Digital Asset Links statement naming the app's package and signing key; and
// Play's payment policy allows no digital purchase inside the app other than
// through Play's own billing, so the pages have to know they were opened from
// it and keep the membership plans and the paid callback pass out of sight.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { startTestApp, stopTestApp, createTestOwner, purgeLoginCollections, uniqueAddress } from "./helpers.js";
import { createSession } from "../lib/auth/session.js";
import { assetLinks, normaliseSha256Fingerprint, ANDROID_APP_PACKAGE } from "../lib/core/pwa.js";

// The suite supplies its own configuration rather than inheriting the
// machine's .env (getEnv() reads process.env afresh inside buildApp()). The
// spellings are the ways a fingerprint gets pasted: Play Console's, keytool's
// with its prefix and a leading space, one that lost its colons in a terminal,
// and two separated by a newline instead of a comma (Play Console lists them
// one per line).
const UPLOAD_KEY = "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A2:B1:72:67:48:8A:6C:88:9A:D6:F4:5E:2B:53:A4";
const PLAY_KEY_LOWER_NO_COLONS = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const PLAY_KEY = "00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF";
process.env.ANDROID_APP_SHA256_FINGERPRINTS =
  ` ${UPLOAD_KEY}\n SHA256: ${PLAY_KEY_LOWER_NO_COLONS} , not-a-fingerprint,,\r\n${UPLOAD_KEY.toLowerCase()}`;

const pwaSource = await readFile(new URL("../../frontend/scripts/pwa.js", import.meta.url), "utf8");
const membershipJs = await readFile(new URL("../../frontend/scripts/owner/membership.js", import.meta.url), "utf8");
const membershipHtml = await readFile(new URL("../../frontend/pages/owner/membership.html", import.meta.url), "utf8");
const membershipCss = await readFile(new URL("../../frontend/styles/owner-membership.css", import.meta.url), "utf8");
const welcomeJs = await readFile(new URL("../../frontend/scripts/owner/welcome.js", import.meta.url), "utf8");
const welcomeHtml = await readFile(new URL("../../frontend/pages/owner/welcome.html", import.meta.url), "utf8");

let app;
let env;
let collections;
let cookie;

before(async () => {
  ({ app, env, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  const owner = await createTestOwner(collections, { email: "android-app-owner@example.invalid" });
  cookie = await createSession(app, {
    id: String(owner._id), role: "owner", email: owner.email, displayName: owner.displayName
  });
});

after(async () => {
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

function get(url, { signedIn = false, headers = {} } = {}) {
  return app.inject({
    method: "GET",
    url,
    headers: { accept: "text/html", ...headers },
    remoteAddress: uniqueAddress(),
    ...(signedIn ? { cookies: { wavetag_session: cookie } } : {})
  });
}

// ── the fingerprints ────────────────────────────────────────────────────────

test("a fingerprint is accepted however it was pasted and written back one way", () => {
  assert.equal(normaliseSha256Fingerprint(UPLOAD_KEY), UPLOAD_KEY);
  assert.equal(normaliseSha256Fingerprint(UPLOAD_KEY.toLowerCase()), UPLOAD_KEY);
  assert.equal(normaliseSha256Fingerprint(PLAY_KEY_LOWER_NO_COLONS), PLAY_KEY);
  assert.equal(normaliseSha256Fingerprint(`SHA256: ${PLAY_KEY}`), PLAY_KEY, "keytool's line");
  assert.equal(normaliseSha256Fingerprint(`  SHA256: ${PLAY_KEY}`), PLAY_KEY, "keytool's line, pasted with its indent");
  assert.equal(normaliseSha256Fingerprint(`sha-256:${PLAY_KEY_LOWER_NO_COLONS}`), PLAY_KEY);
  assert.equal(normaliseSha256Fingerprint(` ${PLAY_KEY} \n`), PLAY_KEY);
});

test("anything that is not 32 bytes of hex is not a fingerprint", () => {
  for (const bad of ["", null, undefined, "not-a-fingerprint", PLAY_KEY.slice(3), PLAY_KEY + ":00", PLAY_KEY.replace("00", "ZZ")]) {
    assert.equal(normaliseSha256Fingerprint(bad), null, String(bad));
  }
});

test("the statement names the package and every valid key once, or is nothing at all", () => {
  const statement = assetLinks({ packageName: ANDROID_APP_PACKAGE, fingerprints: env.androidAppSha256Fingerprints });
  assert.deepEqual(statement, [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "me.parktag.app",
        // The upload key was given twice, in two cases: once in the file.
        sha256_cert_fingerprints: [UPLOAD_KEY, PLAY_KEY]
      }
    }
  ]);

  assert.equal(assetLinks({ packageName: ANDROID_APP_PACKAGE, fingerprints: [] }), null, "no keys");
  assert.equal(assetLinks({ packageName: ANDROID_APP_PACKAGE, fingerprints: ["typo"] }), null, "no valid key");
  assert.equal(assetLinks({ packageName: "", fingerprints: [PLAY_KEY] }), null, "no package");
  assert.equal(assetLinks({ packageName: " ", fingerprints: [PLAY_KEY] }), null, "blank package");
});

test("the environment splits on commas and newlines, and the package is one constant the script shares", () => {
  assert.deepEqual(env.androidAppSha256Fingerprints, [
    UPLOAD_KEY, `SHA256: ${PLAY_KEY_LOWER_NO_COLONS}`, "not-a-fingerprint", UPLOAD_KEY.toLowerCase()
  ]);
  assert.equal("androidAppPackage" in env, false, "not a setting: the served script could not follow one");
  // The script decides "opened from the app" by this exact name; the two must
  // never drift apart or the app would get the plans it is not allowed to sell.
  assert.equal(ANDROID_APP_PACKAGE, "me.parktag.app");
  assert.ok(pwaSource.includes(`var ANDROID_APP_PACKAGE = "${ANDROID_APP_PACKAGE}";`), "pwa.js names the same package");
});

// ── the route ───────────────────────────────────────────────────────────────

test("/.well-known/assetlinks.json is public JSON, cached for an hour", async () => {
  const response = await get("/.well-known/assetlinks.json", { headers: { accept: "*/*" } });
  assert.equal(response.statusCode, 200);
  assert.match(String(response.headers["content-type"]), /application\/json/);
  assert.equal(response.headers["cache-control"], "public, max-age=3600");

  const statement = JSON.parse(response.body);
  assert.equal(statement.length, 1);
  assert.deepEqual(statement[0].relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(statement[0].target.namespace, "android_app");
  assert.equal(statement[0].target.package_name, "me.parktag.app");
  assert.deepEqual(statement[0].target.sha256_cert_fingerprints, [UPLOAD_KEY, PLAY_KEY]);
});

test("the statement needs no session and is the same for a signed-in owner", async () => {
  const anonymous = await get("/.well-known/assetlinks.json");
  const signedIn = await get("/.well-known/assetlinks.json", { signedIn: true });
  assert.equal(anonymous.statusCode, 200);
  assert.equal(signedIn.statusCode, 200);
  assert.equal(anonymous.body, signedIn.body);
});

// ── the launch marker ───────────────────────────────────────────────────────

test("/owner carries the app's launch marker through its redirect, and nothing else", async () => {
  const out = await get("/owner?pt_app=android");
  assert.equal(out.statusCode, 302);
  assert.equal(out.headers.location, "/owner-login?pt_app=android");

  const inn = await get("/owner?pt_app=android", { signedIn: true });
  assert.equal(inn.statusCode, 302);
  assert.equal(inn.headers.location, "/owner-welcome?pt_app=android");

  // The marker is one fixed value, not whatever arrived: no reflection.
  for (const [url, expected] of [
    ["/owner", "/owner-welcome"],
    ["/owner?pt_app=ios", "/owner-welcome"],
    ["/owner?pt_app=android%22%3E", "/owner-welcome"],
    ["/owner?utm_source=x", "/owner-welcome"]
  ]) {
    const response = await get(url, { signedIn: true });
    assert.equal(response.headers.location, expected, url);
  }
});

// ── the script ──────────────────────────────────────────────────────────────

const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36";
const DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

// Runs scripts/pwa.js as a page would: the marker logic executes first, and
// with no serviceWorker on the fake navigator the install logic steps aside.
// `marked` stands for the elements carrying data-hide-in-android-app.
function openPage({ search = "", referrer = "", stored = null, storageRefused = false, marked = 0, userAgent = ANDROID_UA } = {}) {
  const store = new Map();
  if (stored !== null) store.set("pt_android_app", stored);
  const sessionStorage = storageRefused
    ? { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } }
    : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const elements = Array.from({ length: marked }, () => ({ style: {} }));
  const window = { location: { search }, sessionStorage, addEventListener() {} };
  window.window = window;
  const document = {
    referrer,
    getElementById: () => null,
    querySelectorAll: (selector) => (selector === "[data-hide-in-android-app]" ? elements : [])
  };
  const context = vm.createContext({ window, document, navigator: { userAgent } });
  vm.runInContext(pwaSource, context);
  return {
    inApp: context.window.ptInAndroidApp(),
    stored: store.get("pt_android_app") || null,
    hidden: elements.filter((el) => el.style.display === "none").length
  };
}

test("a page the app launched knows it, and remembers for the pages after it", () => {
  assert.deepEqual(openPage({ search: "?pt_app=android" }), { inApp: true, stored: "1", hidden: 0 });
  assert.deepEqual(openPage({ search: "?from=x&pt_app=android&y=2" }), { inApp: true, stored: "1", hidden: 0 });
  assert.deepEqual(openPage({ referrer: "android-app://me.parktag.app" }), { inApp: true, stored: "1", hidden: 0 });
  assert.deepEqual(openPage({ referrer: "android-app://me.parktag.app/" }), { inApp: true, stored: "1", hidden: 0 });
  // A later page in the same session: no marker on it, the flag carries.
  assert.deepEqual(openPage({ stored: "1" }), { inApp: true, stored: "1", hidden: 0 });
});

test("an ordinary browser tab is not the app, whoever opened it", () => {
  assert.deepEqual(openPage(), { inApp: false, stored: null, hidden: 0 });
  assert.deepEqual(openPage({ search: "?pt_app=androidx" }), { inApp: false, stored: null, hidden: 0 });
  assert.deepEqual(openPage({ search: "?pt_app=ios" }), { inApp: false, stored: null, hidden: 0 });
  // A link tapped in WhatsApp arrives with WhatsApp's android-app:// referrer.
  assert.deepEqual(openPage({ referrer: "android-app://com.whatsapp" }), { inApp: false, stored: null, hidden: 0 });
  // The package is matched whole, not as a prefix.
  assert.deepEqual(openPage({ referrer: "android-app://me.parktag.app.evil" }), { inApp: false, stored: null, hidden: 0 });
  assert.deepEqual(openPage({ referrer: "https://me.parktag.app/" }), { inApp: false, stored: null, hidden: 0 });
  assert.deepEqual(openPage({ stored: "0" }), { inApp: false, stored: "0", hidden: 0 });
});

test("the app's launch URL opened on a laptop is a browser tab, not the app", () => {
  // The marker is the app's own launch URL, which can be copied and shared.
  assert.deepEqual(openPage({ search: "?pt_app=android", userAgent: DESKTOP_UA }), { inApp: false, stored: null, hidden: 0 });
  // The referrer cannot be copied, so it counts on any device.
  assert.equal(openPage({ referrer: "android-app://me.parktag.app", userAgent: DESKTOP_UA }).inApp, true);
  assert.equal(openPage({ search: "?pt_app=android", userAgent: "" }).inApp, false);
});

test("inside the app the marked elements are hidden as the page is parsed; outside, left alone", () => {
  assert.equal(openPage({ search: "?pt_app=android", marked: 3 }).hidden, 3);
  assert.equal(openPage({ stored: "1", marked: 2 }).hidden, 2);
  assert.equal(openPage({ marked: 3 }).hidden, 0);
  assert.equal(openPage({ referrer: "android-app://com.whatsapp", marked: 3 }).hidden, 0);
});

test("storage that refuses does not break the page or the answer", () => {
  assert.equal(openPage({ search: "?pt_app=android", storageRefused: true }).inApp, true);
  assert.equal(openPage({ storageRefused: true }).inApp, false);
});

test("the served script carries the marker logic", async () => {
  const page = await get("/owner-login");
  const [, version] = page.body.match(/\/scripts\/pwa\.js\?v=([0-9a-f]{12})/);
  const response = await get(`/scripts/pwa.js?v=${version}`);
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /window\.ptInAndroidApp = function/);
  assert.match(response.body, /android-app:\/\//);
  assert.match(response.body, /\[data-hide-in-android-app\]/);
});

// ── the pages inside the app ────────────────────────────────────────────────

test("the membership screen keeps the plans and the button out of the app, and the picker in", () => {
  // The script loads before the module that asks it: head, defer, in order.
  assert.ok(
    membershipHtml.indexOf('src="/scripts/pwa.js') < membershipHtml.indexOf('src="/scripts/owner/membership.js'),
    "pwa.js is declared before membership.js"
  );
  // Marked, so they are gone before any data arrives, not only after the render.
  assert.match(membershipHtml, /<h2 class="mb-h" id="mbPlansH" data-hide-in-android-app>Choose Your Plan<\/h2>/);
  assert.match(membershipHtml, /<div class="mb-plans" id="mbPlans" data-hide-in-android-app/);
  assert.match(membershipHtml, /<div class="mb-cta-bar" id="mbCtaBar" data-hide-in-android-app>/);
  assert.doesNotMatch(membershipHtml, /id="mbVehiclesWrap"[^>]*data-hide-in-android-app/, "the picker stays: it shows each vehicle's date");
  assert.match(membershipCss, /\.mb-plans\[hidden\], \.mb-cta-bar\[hidden\] \{ display: none; \}/);
  assert.match(membershipCss, /body\.mb-no-bar \{ padding-bottom:/);

  // The bar's padding goes at module start, so the no-network path ends the
  // page the same way as the rendered one.
  const beforeRender = membershipJs.slice(0, membershipJs.indexOf("function renderPlans("));
  assert.match(beforeRender, /if \(inAndroidApp\(\)\) document\.body\.classList\.add\("mb-no-bar"\);/);

  const renderPlans = membershipJs.slice(membershipJs.indexOf("function renderPlans("), membershipJs.indexOf("function renderVehicles("));
  assert.match(renderPlans, /if \(inAndroidApp\(\)\) \{[\s\S]*?fill\(host, null\);[\s\S]*?byId\("mbPlansH"\)\.hidden = true;[\s\S]*?return;/);
  const renderVehicles = membershipJs.slice(membershipJs.indexOf("function renderVehicles("), membershipJs.indexOf("function soonestTag("));
  assert.doesNotMatch(renderVehicles, /inAndroidApp/, "the picker is not hidden in the app");
  const renderCta = membershipJs.slice(membershipJs.indexOf("function renderCta("), membershipJs.indexOf("let busy = false;"));
  assert.match(renderCta, /if \(inAndroidApp\(\)\) \{[\s\S]*?byId\("mbCtaBar"\)\.hidden = true;[\s\S]*?cta\.disabled = true;[\s\S]*?return;\s*\}/);
});

test("what the app says about plans points nowhere: Play reads a pointer to another way of paying as a sale", () => {
  const match = membershipJs.match(/if \(inAndroidApp\(\)\) \{\r?\n\s*byId\("mbCtaBar"\)/);
  assert.ok(match, "the in-app branch of renderCta");
  const branch = membershipJs.slice(match.index, membershipJs.indexOf("return;", match.index));
  assert.match(branch, /Plans are not sold in the ParkTag Android app/);
  assert.doesNotMatch(branch, /https?:|parktag\.me|website|browser/i);
  // The cover date still leads when there is one: it is what the screen is for,
  // and with several vehicles the picker above decides whose.
  assert.match(branch, /Covered until \$\{until\}/);
  assert.match(branch, /Member until \$\{until\}/);
  assert.match(branch, /vehicleName\(tag\)/);
});

test("the dashboard's way to the plans is not offered inside the app, from the first paint", () => {
  assert.match(welcomeHtml, /<a class="pt-pr-prem-cta" id="prPremCta" href="\/owner-membership" role="button" data-hide-in-android-app>View plans<\/a>/);
  // Hidden by the marker, not by the render that follows the dashboard fetch.
  const renderMembership = welcomeJs.slice(welcomeJs.indexOf("function renderMembership("), welcomeJs.indexOf("function renderProfileView("));
  assert.doesNotMatch(renderMembership, /prPremCta/);
  // A lapsed row does not tell the owner to renew where nothing renews.
  const memRow = welcomeJs.slice(welcomeJs.indexOf("function _memRow("), welcomeJs.indexOf("function renderMembership("));
  assert.match(memRow, /inAndroidApp\(\)\s*\?\s*"Premium has ended on this tag\."\s*:\s*"Renew to keep masked calls on this tag\."/);
});

test("the paid callback pass, a digital purchase, is not sold inside the app either", () => {
  // Every place that renders the ₹ pass button has an in-app branch that
  // states the fact and opens no payment: the prompt card and the activity row.
  const payButtons = [...welcomeJs.matchAll(/payForCallback\('/g)].length;
  assert.equal(payButtons, 2, "two places sell the pass: the prompt and the row");
  const prompt = welcomeJs.slice(welcomeJs.indexOf("const cta    = !_ownerMobile"), welcomeJs.indexOf('onclick="payForCallback(\'cbPayPrompt\')'));
  assert.match(prompt, /payPrompt && inAndroidApp\(\)[\s\S]*?Free time<br>used up/);
  const row = welcomeJs.slice(welcomeJs.indexOf("} else if (canBuyCallback(r) && isPayTarget(r)) {"), welcomeJs.indexOf("} else if (canCallBack(r)) {"));
  assert.match(row, /\} else if \(inAndroidApp\(\)\) \{[\s\S]*?Free time<br>used up[\s\S]*?\} else \{[\s\S]*?payForCallback/);
  // And the lapsed-subscription row states the fact instead of "Renew".
  assert.match(row, /cta = inAndroidApp\(\)\s*\?\s*`<span class="pt-act-nophone"[^`]*Call service<br>ended<\/span>`\s*:\s*`<button class="pt-act-nophone pt-act-upsell" onclick="switchTab\('shop'\)"/);
  // The in-app texts point nowhere.
  for (const text of ["Free time<br>used up", "Call service<br>ended"]) {
    const at = welcomeJs.indexOf(text);
    assert.ok(at > 0, text);
    const around = welcomeJs.slice(at - 200, at + 60);
    assert.doesNotMatch(around, /onclick=|href=/, `${text} has no action`);
  }
});
