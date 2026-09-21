// The review request template, and the public shape of a review. No database:
// both are pure functions, and both are the parts whose mistakes reach Meta or
// a stranger's browser.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { buildReviewTemplatePayload } from "../scripts/create-review-template.js";
import { REVIEW_REQUEST_TEMPLATE } from "../lib/integrations/meta.js";
import { toPublicReview, firstPhoto } from "../lib/core/reviews.js";

describe("the template submission", () => {
  const payload = buildReviewTemplatePayload();

  test("it is the template the campaign sends, in the language it sends", () => {
    assert.equal(payload.name, REVIEW_REQUEST_TEMPLATE);
    assert.equal(payload.name, "parktag_review_request_v1");
    // sendTemplate() asks for "en"; en_US would be a different template.
    assert.equal(payload.language, "en");
    assert.equal(payload.category, "UTILITY");
  });

  test("the body has exactly one variable, with the sample Meta demands", () => {
    // sendMetaWhatsappReviewRequest fills one parameter. A mismatch is
    // rejected at send time, not at submission.
    const body = payload.components.find((c) => c.type === "BODY");
    const vars = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
    assert.deepEqual(vars, ["1"]);
    assert.deepEqual(body.example.body_text, [["Priya"]]);
    assert.equal(payload.components.length, 1, "no header, footer or buttons");
  });
});

describe("what a public review carries", () => {
  const stored = {
    _id: "65f000000000000000000001",
    orderId: "65f0000000000000000000aa",
    orderNumber: "PT-260901-00001",
    phone: "+919812345678",
    name: "Priya",
    texts: ["Love it.", "Got a call within a day."],
    photos: [{ mediaId: "m1", mimeType: "image/jpeg" }],
    approved: true,
    receivedAt: "2026-09-20T10:00:00.000Z"
  };

  test("first name, words and a photo link, and nothing else", () => {
    const shown = toPublicReview(stored);
    assert.deepEqual(Object.keys(shown).sort(), ["id", "name", "photoUrl", "receivedAt", "text"]);
    assert.equal(shown.text, "Love it. Got a call within a day.");
    assert.equal(shown.photoUrl, `/api/shop/reviews/${stored._id}/photo`);
    assert.ok(!JSON.stringify(shown).includes("9812345678"));
    assert.ok(!JSON.stringify(shown).includes("PT-260901"));
  });

  test("a stored non-image is never served as a photo", () => {
    // Served from our own origin, so text/html would be a page we host.
    const html = { photos: [{ data: Buffer.from("<script>"), mimeType: "text/html" }] };
    assert.equal(firstPhoto(html), null);
    assert.equal(toPublicReview({ ...stored, photos: html.photos }).photoUrl, null);
    assert.ok(firstPhoto({ photos: [{ data: Buffer.from("x"), mimeType: "image/png" }] }));
  });
});
