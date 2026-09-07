// The "Save our number" card on the owner dashboard.
//
// A masked call reaches an owner from ParkTag's line, not from the finder's, so
// it arrives as an unknown number — the kind people let ring out. The dashboard
// offers the number as a contact card to fix that.
//
// There is no web API that can write a contact, so the file IS the mechanism:
// the browser hands it to the operating system, which opens its own contact
// screen with the fields filled. That makes the response headers and the bytes
// load-bearing in a way a normal page's are not — get either wrong and the
// button silently does nothing useful, on a device nobody is testing on.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startTestApp, stopTestApp, uniqueAddress } from "./helpers.js";

const NUMBER = "08047284348";

let app;

before(async () => {
  ({ app } = await startTestApp());
});

after(async () => {
  await stopTestApp(app);
});

const fetchCard = () =>
  app.inject({ method: "GET", url: "/parktag.vcf", remoteAddress: uniqueAddress() });

describe("the ParkTag contact card", () => {
  test("it is served as a contact card, not as text to look at", async () => {
    const res = await fetchCard();

    assert.equal(res.statusCode, 200);

    // text/vcard is what tells the OS this is a contact. Served as text/plain
    // the browser just shows the file, and the button does nothing.
    assert.match(
      res.headers["content-type"],
      /^text\/vcard(;|$)/,
      "not sent as a contact card, so the OS will not offer to save it"
    );

    // The filename is what makes the download legible in Android's tray and in
    // Files on iOS; without it the person is handed something called "parktag".
    assert.match(
      String(res.headers["content-disposition"] || ""),
      /filename="ParkTag\.vcf"/,
      "the download has no .vcf filename"
    );
  });

  test("it carries the number, in a form both platforms parse", async () => {
    const body = (await fetchCard()).body;

    assert.match(body, /^BEGIN:VCARD\r\n/, "missing or malformed opening line");
    assert.match(body, /\r\nEND:VCARD\r\n?$/, "missing or malformed closing line");

    // 3.0 rather than 4.0: it is the version every iOS and Android in
    // circulation reads. A 4.0 card is silently rejected by older importers.
    assert.match(body, /\r\nVERSION:3\.0\r\n/, "not vCard 3.0");

    assert.match(
      body,
      new RegExp(`\\r\\nTEL[^\\r\\n]*:${NUMBER}\\r\\n`),
      `the card does not carry ${NUMBER}`
    );
    assert.match(body, /\r\nFN:ParkTag\r\n/, "the contact would save without a name");

    // RFC 6350 specifies CRLF and Android's importer holds it to that. A bare
    // LF here is the classic "it works on my iPhone" bug.
    const bareNewlines = body.split("\n").filter((line, i, all) =>
      i < all.length - 1 && !line.endsWith("\r")
    );
    assert.equal(bareNewlines.length, 0, "a line ends with a bare LF instead of CRLF");
  });

  test("it needs no session, because the download is a plain navigation", async () => {
    // The link sits on an authenticated page, but tapping it is a top-level
    // navigation that carries no session expectations of its own. Gating this
    // would break the button on any device that opens downloads out of process.
    const res = await fetchCard();

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers.location, undefined, "redirecting instead of serving the card");
  });
});
