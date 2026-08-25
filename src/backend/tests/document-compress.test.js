// Shrinking a document before it is uploaded.
//
// A phone photo of an RC is 3-5MB and the same document is legible at ~42KB.
// That matters twice over: it is what lets the cluster hold a large customer
// base, and it is the difference between an upload that finishes on one bar in
// a basement car park and one that does not.
//
// The rules are tested here rather than in a browser because the interesting
// parts are decisions, not drawing: which rung of the quality ladder to stop
// at, when re-encoding is not worth it, and — most of all — what happens when
// the browser lets us down. Every failure path has to end with the ORIGINAL
// file being uploaded. Refusing to store somebody's registration certificate
// because a canvas misbehaved would be a far worse bug than storing it large.
//
// No DOM: decoding, drawing and encoding are all injected, which is what the
// module takes them as options for.
import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  prepareDocument,
  isCompressibleImage,
  isWorthKeeping,
  renameFor,
  scaledSize,
  LADDER,
  TARGET_BYTES,
  MAX_DECODE_BYTES
} from "../../frontend/scripts/owner/document-compress.js";

const MB = 1024 * 1024;

function fakeFile({ name = "rc.jpg", type = "image/jpeg", size = 4.8 * MB } = {}) {
  return { name, type, size };
}

// A decoded image of a given pixel size, which records whether it was released.
function fakeBitmap(width = 3000, height = 4000) {
  const bitmap = { width, height, closed: false };
  bitmap.close = () => { bitmap.closed = true; };
  return bitmap;
}

// Stands in for a canvas. Records what it was asked to draw.
function fakeCanvas(width, height) {
  return { width, height, toDataURL: () => `data:image/jpeg;base64,thumb-${width}x${height}` };
}

// Builds the injected dependencies. `sizes` maps a rung index to the byte size
// that rung's encode should produce, so a test can describe the shape of the
// ladder's output without caring how encoding works.
function deps({ sizes, thumbThrows = false, decodeThrows = false, encodeNull = false, type = "image/webp" } = {}) {
  const drawn = [];
  let decodeCalls = 0;
  let encodeCalls = 0;
  const bitmap = fakeBitmap();

  return {
    drawn,
    bitmap,
    get decodeCalls() { return decodeCalls; },
    get encodeCalls() { return encodeCalls; },
    options: {
      decode: async () => {
        decodeCalls += 1;
        if (decodeThrows) throw new Error("decode failed");
        return bitmap;
      },
      draw: (_source, width, height) => {
        // The thumbnail is the first draw; it is the only one at 320px or less.
        if (thumbThrows && Math.max(width, height) <= 320) throw new Error("thumb failed");
        drawn.push({ width, height });
        return fakeCanvas(width, height);
      },
      encodeImage: async (canvas) => {
        if (encodeNull) return null;
        const index = encodeCalls;
        encodeCalls += 1;
        const size = Array.isArray(sizes) ? sizes[Math.min(index, sizes.length - 1)] : sizes;
        return { size, type, canvas };
      },
      makeFile: (blob, name) => ({ name, type: blob.type, size: blob.size })
    }
  };
}

// ── The pure rules ──────────────────────────────────────────────────────────

describe("the rules, on their own", () => {
  test("only the image types the vault actually stores are compressed", () => {
    assert.equal(isCompressibleImage("image/jpeg"), true);
    assert.equal(isCompressibleImage("image/png"), true);
    assert.equal(isCompressibleImage("image/webp"), true);
    assert.equal(isCompressibleImage("IMAGE/JPEG"), true, "the browser may report any case");
    // A PDF is an already-compressed container, and re-encoding one in the
    // browser would mean shipping a PDF renderer to do it.
    assert.equal(isCompressibleImage("application/pdf"), false);
    // Never allowed into the vault in the first place — see ALLOWED_MIME.
    assert.equal(isCompressibleImage("image/svg+xml"), false);
    assert.equal(isCompressibleImage(""), false);
    assert.equal(isCompressibleImage(undefined), false);
  });

  test("scaling fits the long edge and never enlarges", () => {
    assert.deepEqual(scaledSize(4000, 3000, 2000), { width: 2000, height: 1500 });
    assert.deepEqual(scaledSize(3000, 4000, 2000), { width: 1500, height: 2000 }, "portrait scales on its own long edge");
    // Enlarging costs bytes and adds no detail.
    assert.deepEqual(scaledSize(800, 600, 2000), { width: 800, height: 600 });
    // Degenerate input must still produce a canvas that can be created.
    assert.deepEqual(scaledSize(0, 0, 2000), { width: 1, height: 1 });
  });

  test("a re-encode that does not win is not worth keeping", () => {
    assert.equal(isWorthKeeping(4.8 * MB, 42 * 1024), true);
    assert.equal(isWorthKeeping(50 * 1024, 90 * 1024), false, "inflating a file is worse than doing nothing");
    // A tie counts as a loss: the original is what the owner chose, and
    // swapping it for a same-sized re-encode trades quality for nothing.
    assert.equal(isWorthKeeping(50 * 1024, 50 * 1024), false);
    assert.equal(isWorthKeeping(50 * 1024, 0), false, "an empty encode is a failure, not a great result");
  });

  test("the stored name matches the bytes inside it", () => {
    // Cosmetic — the server names the blob from the type it verified — but a
    // file that downloads as .jpg holding WebP confuses the device opening it.
    assert.equal(renameFor("rc front.jpg", "image/webp"), "rc front.webp");
    assert.equal(renameFor("scan.PNG", "image/jpeg"), "scan.jpg");
    assert.equal(renameFor("no-extension", "image/webp"), "no-extension.webp");
    assert.equal(renameFor("", "image/webp"), "document.webp");
    assert.equal(renameFor(undefined, "image/jpeg"), "document.jpg");
    assert.equal(renameFor(".jpg", "image/webp"), "document.webp", "a name that is only an extension");
  });

  test("the ladder descends and starts somewhere legible", () => {
    // 2000px on the long edge is ~170 DPI for A4. The legibility check was done
    // at 1600px, so the top rung has margin over what was actually verified.
    assert.ok(LADDER.length >= 2);
    assert.equal(LADDER[0].maxEdge, 2000);
    for (let i = 1; i < LADDER.length; i += 1) {
      assert.ok(LADDER[i].maxEdge < LADDER[i - 1].maxEdge, "each rung must be smaller than the last");
      assert.ok(LADDER[i].quality < LADDER[i - 1].quality, "and cheaper");
    }
    assert.ok(LADDER[LADDER.length - 1].maxEdge >= 1200,
      "the bottom rung still has to be a readable document, not a thumbnail");
  });
});

// ── The pass an upload makes ────────────────────────────────────────────────

describe("compressing a picked file", () => {
  test("a phone photo is replaced by a much smaller one", async () => {
    const d = deps({ sizes: 42 * 1024 });
    const result = await prepareDocument(fakeFile({ size: 4.8 * MB }), d.options);

    assert.equal(result.compressed, true);
    assert.equal(result.storedBytes, 42 * 1024);
    assert.equal(result.originalBytes, 4.8 * MB);
    assert.equal(result.file.type, "image/webp");
    assert.equal(result.file.name, "rc.webp");
  });

  test("it stops at the first rung under the target", async () => {
    // No reason to keep degrading a document that is already small enough.
    const d = deps({ sizes: [TARGET_BYTES - 1] });
    await prepareDocument(fakeFile(), d.options);

    assert.equal(d.encodeCalls, 1, `tried ${d.encodeCalls} rungs when the first one was enough`);
  });

  test("a stubborn scan walks down the ladder", async () => {
    // Dense, noisy documents do not come under the target at the top rung.
    const sizes = [900 * 1024, 700 * 1024, 500 * 1024, 300 * 1024, TARGET_BYTES - 1];
    const d = deps({ sizes });
    const result = await prepareDocument(fakeFile({ size: 5 * MB }), d.options);

    assert.equal(d.encodeCalls, 5, "it gave up before the bottom of the ladder");
    assert.equal(result.storedBytes, TARGET_BYTES - 1);
  });

  test("when nothing reaches the target the smallest attempt is kept", async () => {
    // Not the LAST attempt — a lower rung can come out marginally larger on
    // some content, and there is no reason to store the bigger one after
    // paying to produce both.
    const sizes = [900 * 1024, 400 * 1024, 320 * 1024, 380 * 1024, 350 * 1024];
    const d = deps({ sizes });
    const result = await prepareDocument(fakeFile({ size: 5 * MB }), d.options);

    assert.equal(d.encodeCalls, LADDER.length, "every rung should have been tried");
    assert.equal(result.storedBytes, 320 * 1024, "it kept an attempt that was not the smallest");
    assert.equal(result.compressed, true);
  });

  test("the image is decoded once no matter how many rungs are tried", async () => {
    // A 12MP photo is ~48MB of RGBA. Decoding it once per rung on a mid-range
    // phone is the difference between a pause and a crash.
    const d = deps({ sizes: [900 * 1024, 800 * 1024, 700 * 1024, 600 * 1024, 500 * 1024] });
    await prepareDocument(fakeFile(), d.options);

    assert.equal(d.decodeCalls, 1, `decoded ${d.decodeCalls} times`);
    assert.equal(d.encodeCalls, LADDER.length, "precondition: the ladder was actually walked");
  });

  test("the decoded image is released afterwards", async () => {
    // An ImageBitmap holds its pixels outside the JS heap and is not reclaimed
    // by ordinary garbage collection.
    const d = deps({ sizes: 42 * 1024 });
    await prepareDocument(fakeFile(), d.options);
    assert.equal(d.bitmap.closed, true, "the bitmap was left holding its pixels");
  });

  test("the thumbnail comes off the same decode", async () => {
    const d = deps({ sizes: 42 * 1024 });
    const result = await prepareDocument(fakeFile(), d.options);

    assert.match(result.thumb, /^data:image\/jpeg/);
    const thumbDraw = d.drawn.find((x) => Math.max(x.width, x.height) <= 320);
    assert.ok(thumbDraw, "nothing was drawn at thumbnail size");
    assert.equal(d.decodeCalls, 1, "the thumbnail cost a second decode");
  });
});

describe("when the browser lets us down, the document still uploads", () => {
  test("a PDF is passed through untouched", async () => {
    const pdf = fakeFile({ name: "rc.pdf", type: "application/pdf", size: 900 * 1024 });
    const d = deps({ sizes: 1 });
    const result = await prepareDocument(pdf, d.options);

    assert.equal(result.file, pdf, "the PDF was altered");
    assert.equal(result.compressed, false);
    assert.equal(result.reason, "pdf");
    assert.equal(result.thumb, null, "there is no bitmap in a PDF to make a thumbnail from");
    assert.equal(d.decodeCalls, 0, "a PDF must not be handed to an image decoder");
  });

  test("a file too large to decode is refused before it is decoded", async () => {
    // The guard belongs BEFORE the decode: decoding is the step that would
    // exhaust memory, so checking afterwards would be checking too late.
    const huge = fakeFile({ size: MAX_DECODE_BYTES + 1 });
    const d = deps({ sizes: 1 });
    const result = await prepareDocument(huge, d.options);

    assert.equal(result.file, huge);
    assert.equal(result.reason, "too-large-to-decode");
    assert.equal(d.decodeCalls, 0);
  });

  test("a file the browser cannot decode is uploaded as-is", async () => {
    const file = fakeFile();
    const d = deps({ decodeThrows: true });
    const result = await prepareDocument(file, d.options);

    assert.equal(result.file, file, "a decode failure must not lose the document");
    assert.equal(result.compressed, false);
    assert.equal(result.reason, "decode-failed");
    assert.equal(result.storedBytes, file.size);
  });

  test("a browser with no working encoder uploads the original", async () => {
    // canvas.toBlob handing back nothing usable — the module treats that as
    // "cannot compress", never as "cannot upload".
    const file = fakeFile();
    const result = await prepareDocument(file, deps({ encodeNull: true }).options);

    assert.equal(result.file, file);
    assert.equal(result.reason, "encode-failed");
  });

  test("an already-small image is left alone", async () => {
    // Some files are already tighter than we would re-encode them.
    const small = fakeFile({ size: 30 * 1024 });
    const result = await prepareDocument(small, deps({ sizes: 45 * 1024 }).options);

    assert.equal(result.file, small, "re-encoding inflated the file and it was kept anyway");
    assert.equal(result.compressed, false);
    assert.equal(result.reason, "already-small");
    assert.equal(result.storedBytes, small.size);
  });

  test("a failed thumbnail costs an icon, not the upload", async () => {
    const d = deps({ sizes: 42 * 1024, thumbThrows: true });
    const result = await prepareDocument(fakeFile(), d.options);

    assert.equal(result.thumb, null);
    assert.equal(result.compressed, true, "the document itself should still have been compressed");
  });

  test("an image with no dimensions is uploaded as-is", async () => {
    const file = fakeFile();
    const result = await prepareDocument(file, {
      ...deps({ sizes: 1 }).options,
      decode: async () => ({ width: 0, height: 0 })
    });

    assert.equal(result.file, file);
    assert.equal(result.reason, "no-dimensions");
  });

  test("a JPEG fallback is named and typed as a JPEG", async () => {
    // Safari before 14 has no WebP encoder, so the module falls back — and the
    // stored name has to follow the bytes.
    const d = deps({ sizes: 60 * 1024, type: "image/jpeg" });
    const result = await prepareDocument(fakeFile({ name: "insurance.png", type: "image/png" }), d.options);

    assert.equal(result.file.type, "image/jpeg");
    assert.equal(result.file.name, "insurance.jpg");
    assert.equal(result.compressed, true);
  });

  test("nothing in here throws", async () => {
    // The caller uploads whatever comes back. A rejected promise would strand
    // the button on "Preparing…" with no error and no document.
    const cases = [
      [fakeFile(), { decode: async () => { throw new Error("x"); } }],
      [fakeFile(), { draw: () => { throw new Error("x"); } }],
      [fakeFile(), { encodeImage: async () => { throw new Error("x"); } }],
      [fakeFile(), { makeFile: () => { throw new Error("x"); } }]
    ];
    for (const [file, override] of cases) {
      const result = await prepareDocument(file, { ...deps({ sizes: 42 * 1024 }).options, ...override });
      assert.ok(result && result.file, `no file came back for ${Object.keys(override)[0]}`);
      assert.equal(result.file.size, file.size, "the fallback must be the original file");
    }
  });
});
