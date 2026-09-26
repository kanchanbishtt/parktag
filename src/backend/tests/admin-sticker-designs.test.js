// /admin/sticker-designer: sticker designs, and which one prints.
//
// What must hold:
//
//   1. Admin only, including the artwork files.
//   2. With nothing published, print paths get the original artwork and the
//      exact QR / serial positions they always hard-coded.
//   3. A design is refused, not trimmed, when its QR is too small or outside
//      the sticker, or its artwork could run script or fetch outside files.
//   4. One design is live at a time; publishing another retires it, and the
//      live one cannot be edited in place or deleted.
//   5. The single-sticker print page prints the live design.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress, purgeLoginCollections, TEST_ORIGIN } from "./helpers.js";
import { createPasswordHash } from "../lib/auth/security.js";
import { ensureCoreIndexes } from "../lib/db/repositories.js";
import {
  DEFAULT_ARTWORK_URL,
  DEFAULT_LAYOUT,
  overlayStyles,
  validateArtworkSvg
} from "../lib/core/sticker-design.js";

const ADMIN_EMAIL = "sticker-designer-admin@parktag.test";
const PASSWORD = "test-password-123";
const TAG_TOKEN = "stickerdesign000000000001";

let app;
let collections;
let adminCookie;
let tagId;

const ARTWORK = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="600" viewBox="0 0 1000 600">' +
  '<rect width="1000" height="600" fill="#ffffff"/>' +
  '<image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/>' +
  '<text font-family="Arial" x="40" y="80">Hello</text></svg>';

function design(overrides = {}) {
  return {
    name: "Test design",
    canvasJson: JSON.stringify({ version: "6.9.1", objects: [] }),
    artworkSvg: ARTWORK,
    layout: {
      qr: { x: 600, y: 60, size: 300 },
      serial: { x: 600, y: 20, width: 300, fontSize: 14, fill: "#000000", fontFamily: "monospace", align: "right", visible: true }
    },
    ...overrides
  };
}

function request(method, url, payload, cookie = adminCookie) {
  return app.inject({
    method,
    url,
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN, ...(cookie ? { cookie } : {}), ...(payload ? { "content-type": "application/json" } : {}) },
    ...(payload ? { payload } : {})
  });
}

before(async () => {
  ({ app, collections } = await startTestApp());
  await purgeLoginCollections(collections);
  await collections.stickerDesigns.deleteMany({});
  await ensureCoreIndexes(collections, null);
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await collections.admins.insertOne({
    email: ADMIN_EMAIL,
    role: "admin",
    passwordHash: await createPasswordHash(PASSWORD),
    createdAt: new Date().toISOString()
  });
  await collections.tags.deleteMany({ token: TAG_TOKEN });
  ({ insertedId: tagId } = await collections.tags.insertOne({
    token: TAG_TOKEN,
    serialNumber: 42,
    batchNumber: "7",
    ownerId: null,
    status: "unclaimed",
    printStatus: "pending_print",
    createdAt: new Date().toISOString()
  }));
  const login = await app.inject({
    method: "POST",
    url: "/api/auth/admin/login",
    remoteAddress: uniqueAddress(),
    headers: { origin: TEST_ORIGIN },
    payload: { email: ADMIN_EMAIL, password: PASSWORD }
  });
  assert.equal(login.statusCode, 200, "fixture admin login should succeed");
  adminCookie = [login.headers["set-cookie"]].flat().map((c) => c.split(";")[0]).join("; ");
});

after(async () => {
  await collections.stickerDesigns.deleteMany({});
  await collections.tags.deleteMany({ _id: tagId });
  await collections.admins.deleteMany({ email: ADMIN_EMAIL });
  await purgeLoginCollections(collections);
  await stopTestApp(app);
});

describe("sticker designs", () => {
  test("defaults reproduce the positions the print CSS always hard-coded", () => {
    const styles = overlayStyles(DEFAULT_LAYOUT);
    assert.match(styles.qr, /left:63\.14%;top:11\.83%;width:30\.64%/);
    // right: 6.22%, top: 3%, 1.3cqw in the old CSS.
    assert.match(styles.serial, /left:63\.78%/);
    assert.match(styles.serial, /width:30%/);
    assert.match(styles.serial, /top:3%/);
    assert.match(styles.serial, /font-size:1\.3cqw/);
    assert.match(styles.serial, /text-align:right/);
    assert.doesNotMatch(styles.serial, /"/, "styles must fit inside a double-quoted style attribute");
  });

  test("artwork check accepts Fabric's output and refuses script or outside files", () => {
    assert.equal(validateArtworkSvg(ARTWORK), ARTWORK);
    for (const bad of [
      ARTWORK.replace("</svg>", "<script>alert(1)</script></svg>"),
      ARTWORK.replace("<rect", '<rect onload="alert(1)"'),
      ARTWORK.replace("data:image/png;base64,iVBORw0KGgo=", "https://evil.example/x.png"),
      ARTWORK.replace("</svg>", '<rect fill="url(https://evil.example/a)"/></svg>'),
      ARTWORK.replace("</svg>", "<foreignObject><div/></foreignObject></svg>"),
      '<!DOCTYPE svg [<!ENTITY x "y">]>' + ARTWORK,
      "<html><body>not svg</body></html>"
    ]) {
      assert.throws(() => validateArtworkSvg(bad), undefined, bad.slice(0, 80));
    }
  });

  test("admin only", async () => {
    for (const [method, url] of [
      ["GET", "/api/admin/sticker-designs"],
      ["GET", "/api/admin/sticker-designs/current"],
      ["POST", "/api/admin/sticker-designs/unpublish"]
    ]) {
      const res = await request(method, url, undefined, null);
      assert.ok([401, 403].includes(res.statusCode), `${method} ${url} answered ${res.statusCode} without a session`);
    }
    const create = await request("POST", "/api/admin/sticker-designs", design(), null);
    assert.ok([401, 403].includes(create.statusCode));
    assert.equal(await collections.stickerDesigns.countDocuments({}), 0);
  });

  test("with nothing published, prints use the original artwork", async () => {
    const res = await request("GET", "/api/admin/sticker-designs/current");
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.designId, null);
    assert.equal(body.artworkUrl, DEFAULT_ARTWORK_URL);
    assert.deepEqual(body.layout, JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));

    const page = await request("GET", `/admin/sticker/${TAG_TOKEN}`);
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /src="\/images\/org-parktag-sticker\.svg"/);
    assert.match(page.body, /left:63\.14%;top:11\.83%;width:30\.64%/);
    assert.match(page.body, /PT-07-000042/);
    assert.doesNotMatch(page.body, /__(ARTWORK_URL|QR_STYLE|SERIAL_STYLE)__/);
  });

  test("refuses designs whose QR would not scan or whose artwork is unsafe", async () => {
    const cases = [
      [design({ layout: { ...design().layout, qr: { x: 10, y: 10, size: 100 } } }), /at least/],
      [design({ layout: { ...design().layout, qr: { x: 800, y: 10, size: 300 } } }), /inside the sticker/],
      [design({ layout: { ...design().layout, serial: { ...design().layout.serial, fontFamily: "Comic Neue" } } }), /print-safe/],
      [design({ artworkSvg: ARTWORK.replace("</svg>", "<script>1</script></svg>") }), /scripts/],
      [design({ canvasJson: "{not json" }), /could not be read/],
      [design({ name: "   " }), /name/]
    ];
    for (const [payload, message] of cases) {
      const res = await request("POST", "/api/admin/sticker-designs", payload);
      assert.equal(res.statusCode, 400, JSON.stringify(res.json()));
      assert.match(res.json().error, message);
    }
    assert.equal(await collections.stickerDesigns.countDocuments({}), 0);
  });

  test("draft, publish, edit rules and the print page", async () => {
    const created = await request("POST", "/api/admin/sticker-designs", design({ name: "First" }));
    assert.equal(created.statusCode, 200);
    const first = created.json().design;
    assert.equal(first.status, "draft");

    // Drafts can be edited.
    const edited = await request("PUT", `/api/admin/sticker-designs/${first.id}`, design({ name: "First, edited" }));
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.json().design.name, "First, edited");

    // Publish: it becomes what prints.
    const published = await request("POST", `/api/admin/sticker-designs/${first.id}/publish`);
    assert.equal(published.statusCode, 200);
    const current = (await request("GET", "/api/admin/sticker-designs/current")).json();
    assert.equal(current.designId, first.id);
    assert.match(current.artworkUrl, new RegExp(`^/admin/sticker-art/${first.id}\\.svg\\?v=`));
    assert.match(current.styles.qr, /left:60%;top:10%;width:30%/);

    // The single-sticker page prints it.
    const page = await request("GET", `/admin/sticker/${TAG_TOKEN}`);
    assert.match(page.body, new RegExp(`src="/admin/sticker-art/${first.id}\\.svg\\?v=`));
    assert.match(page.body, /left:60%;top:10%;width:30%/);

    // The artwork is served, sandboxed, to admins only.
    const art = await request("GET", `/admin/sticker-art/${first.id}.svg`);
    assert.equal(art.statusCode, 200);
    assert.match(art.headers["content-type"], /^image\/svg\+xml/);
    assert.match(art.headers["content-security-policy"], /sandbox/);
    assert.equal(art.body, ARTWORK);
    const anonArt = await request("GET", `/admin/sticker-art/${first.id}.svg`, undefined, null);
    assert.ok([401, 403].includes(anonArt.statusCode));

    // The live design is not edited in place or deleted.
    const liveEdit = await request("PUT", `/api/admin/sticker-designs/${first.id}`, design({ name: "Sneaky" }));
    assert.equal(liveEdit.statusCode, 409);
    const liveDelete = await request("DELETE", `/api/admin/sticker-designs/${first.id}`);
    assert.equal(liveDelete.statusCode, 409);

    // Publishing a second design retires the first: one live design at a time.
    const second = (await request("POST", "/api/admin/sticker-designs", design({ name: "Second" }))).json().design;
    assert.equal((await request("POST", `/api/admin/sticker-designs/${second.id}/publish`)).statusCode, 200);
    const statuses = Object.fromEntries(
      (await collections.stickerDesigns.find({}).toArray()).map((d) => [String(d._id), d.status])
    );
    assert.equal(statuses[first.id], "retired");
    assert.equal(statuses[second.id], "published");
    assert.equal(await collections.stickerDesigns.countDocuments({ status: "published" }), 1);

    // The retired one can now be deleted.
    assert.equal((await request("DELETE", `/api/admin/sticker-designs/${first.id}`)).statusCode, 200);

    // Back to the original artwork.
    assert.equal((await request("POST", "/api/admin/sticker-designs/unpublish")).statusCode, 200);
    const reset = (await request("GET", "/api/admin/sticker-designs/current")).json();
    assert.equal(reset.designId, null);
    assert.equal(reset.artworkUrl, DEFAULT_ARTWORK_URL);
  });

  test("the database allows only one published design", async () => {
    await collections.stickerDesigns.insertOne({ name: "A", status: "published", updatedAt: new Date().toISOString() });
    await assert.rejects(
      collections.stickerDesigns.insertOne({ name: "B", status: "published", updatedAt: new Date().toISOString() }),
      (error) => error.code === 11000
    );
    await collections.stickerDesigns.deleteMany({});
  });
});
