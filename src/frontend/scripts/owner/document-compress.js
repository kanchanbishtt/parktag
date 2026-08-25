// ── Shrinking a document before it is uploaded ─────────────────────────────
//
// A phone photo of an RC is 3-5MB. Measured on a realistic one: 4.79MB from the
// camera, 42KB at 1600px WebP q80, with the chassis number, engine number and
// address all still crisply legible. That is the same document, 114 times
// smaller.
//
// It is done HERE, in the browser, rather than on the server, and the reason is
// not only storage. The vault is used at the side of a road and in basement car
// parks, and 42KB is an upload that finishes on one bar where 4.79MB does not.
// Compressing after the bytes have already crossed the network would save the
// cluster and do nothing for the person standing there. Server-side re-encoding
// would also mean an image library in the API process, which is exactly what
// the thumbnail comment in lib/core/vault.js declined for the same reason.
//
// What is NOT touched:
//
//   • PDFs. They are already compressed containers, and re-encoding one in the
//     browser would mean shipping a PDF renderer to do it — a large download to
//     save bytes on a file that is usually small to begin with.
//   • Anything that comes out no smaller than it went in. Some images are
//     already tighter than we would re-encode them, and a "compression" step
//     that inflates a file is worse than none.
//   • Anything the browser cannot decode. The original is uploaded unchanged;
//     a document that stores is worth more than a document that compresses.
//
// The policy below is pure and the drawing is injected, so the rules — which
// rung of the ladder, when to keep the original, what the file ends up called —
// are testable without a canvas.

// What one stored document should come in under. Not a hard limit: it is the
// point at which the ladder stops trying, because past here the loss of detail
// costs more than the bytes are worth.
export const TARGET_BYTES = 250 * 1024;

// Tried in order, stopping at the first rung that lands under TARGET_BYTES.
// The top rung is where nearly everything settles; the lower ones exist for
// dense, noisy scans that do not.
//
// 2000px on the long edge is about 170 DPI for an A4 page. The legibility check
// was done at 1600px, so the top rung has margin over what was verified rather
// than sitting exactly on it.
export const LADDER = [
  { maxEdge: 2000, quality: 0.82 },
  { maxEdge: 1800, quality: 0.78 },
  { maxEdge: 1600, quality: 0.75 },
  { maxEdge: 1400, quality: 0.7 },
  { maxEdge: 1200, quality: 0.62 }
];

// Big enough for any real photograph, small enough that a mis-picked video or
// disk image is refused before it is decoded. Decoding is the expensive step —
// a 12MP photo is ~48MB of RGBA in memory — so the guard belongs before it.
export const MAX_DECODE_BYTES = 40 * 1024 * 1024;

export const THUMB_MAX_EDGE = 320;
export const THUMB_QUALITY = 0.7;

const COMPRESSIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isCompressibleImage(type) {
  return COMPRESSIBLE.has(String(type || "").toLowerCase());
}

// Long edge scaled to `maxEdge`, aspect preserved, never scaled UP — enlarging
// a small image would cost bytes and add no detail.
export function scaledSize(width, height, maxEdge) {
  const w = Math.max(1, Math.round(width || 0));
  const h = Math.max(1, Math.round(height || 0));
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Re-encoding is only worth it if it actually wins. A tie counts as a loss:
// the original is the file the owner chose, and swapping it for a re-encode of
// identical size trades a generation of quality for nothing.
export function isWorthKeeping(originalBytes, compressedBytes) {
  return compressedBytes > 0 && compressedBytes < originalBytes;
}

// The stored filename. Only cosmetic — the server names the blob from the MIME
// type it verified — but a document that downloads as "rc.jpg" while holding
// WebP bytes confuses the device that opens it.
export function renameFor(originalName, mimeType) {
  const ext = mimeType === "image/webp" ? "webp" : "jpg";
  const base = String(originalName || "document").replace(/\.[^.]+$/, "") || "document";
  return `${base}.${ext}`;
}

// ── Browser plumbing ───────────────────────────────────────────────────────

// Decoded with EXIF orientation applied. This is load-bearing, not a nicety:
// a phone held in portrait writes landscape pixels plus an orientation flag,
// and a canvas that ignores the flag stores every such document rotated 90
// degrees. createImageBitmap is asked for it explicitly; the <img> fallback
// gets it from the browser's own default handling.
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (_) {
      // Older Safari rejects the options argument rather than ignoring it.
      try {
        return await createImageBitmap(file);
      } catch (_ignored) {
        // fall through to the <img> path
      }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawTo(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  // Documents are opaque. A PNG with transparency would otherwise composite
  // onto black once the alpha channel is dropped by lossy encoding, which turns
  // a scanned page into an unreadable dark rectangle.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

// canvas.toBlob does NOT reject an unsupported type — it silently encodes PNG
// instead, which for a photograph is far larger than the JPEG it replaced. So
// the type that comes back is checked rather than the type that went in.
function encode(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob && blob.type === type ? blob : null), type, quality);
  });
}

async function encodeBest(canvas, quality) {
  const webp = await encode(canvas, "image/webp", quality);
  if (webp) return webp;
  // Safari before 14, and anything else without a WebP encoder.
  return encode(canvas, "image/jpeg", quality);
}

// ── The pass an upload actually makes ──────────────────────────────────────

/**
 * Returns { file, thumb, originalBytes, storedBytes, compressed, reason }.
 *
 * `file` is always something uploadable — the compressed version when that
 * won, the untouched original otherwise. This function does not throw: every
 * failure path falls back to the original, because refusing to store somebody's
 * RC because a canvas misbehaved would be a much worse outcome than storing it
 * at full size.
 *
 * The image is decoded ONCE and used for both the stored document and the card
 * thumbnail. Decoding a 12MP photo twice on a mid-range phone is the difference
 * between a pause and a crash.
 */
export async function prepareDocument(file, deps = {}) {
  const {
    decode = decodeImage,
    draw = drawTo,
    encodeImage = encodeBest,
    ladder = LADDER,
    targetBytes = TARGET_BYTES,
    maxDecodeBytes = MAX_DECODE_BYTES,
    makeFile = (blob, name) => new File([blob], name, { type: blob.type })
  } = deps;

  const result = {
    file,
    thumb: null,
    originalBytes: file.size,
    storedBytes: file.size,
    compressed: false,
    reason: null
  };

  if (!isCompressibleImage(file.type)) {
    result.reason = file.type === "application/pdf" ? "pdf" : "not-an-image";
    return result;
  }
  if (file.size > maxDecodeBytes) {
    result.reason = "too-large-to-decode";
    return result;
  }

  let source;
  try {
    source = await decode(file);
  } catch (_) {
    result.reason = "decode-failed";
    return result;
  }

  try {
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    if (!width || !height) {
      result.reason = "no-dimensions";
      return result;
    }

    // Thumbnail first, off the same decode. Wrapped separately so a thumbnail
    // failure costs a placeholder icon and not the upload.
    try {
      const t = scaledSize(width, height, THUMB_MAX_EDGE);
      result.thumb = draw(source, t.width, t.height).toDataURL("image/jpeg", THUMB_QUALITY);
    } catch (_) {
      result.thumb = null;
    }

    let best = null;
    for (const rung of ladder) {
      const size = scaledSize(width, height, rung.maxEdge);
      const blob = await encodeImage(draw(source, size.width, size.height), rung.quality);
      if (!blob) continue;
      // Keep the smallest seen, not merely the last tried: a lower rung can
      // come out marginally larger on some content, and there is no reason to
      // store the bigger one after paying to produce both.
      if (!best || blob.size < best.size) best = blob;
      if (blob.size <= targetBytes) break;
    }

    if (!best) {
      result.reason = "encode-failed";
      return result;
    }
    if (!isWorthKeeping(file.size, best.size)) {
      result.reason = "already-small";
      return result;
    }

    result.file = makeFile(best, renameFor(file.name, best.type));
    result.storedBytes = best.size;
    result.compressed = true;
    return result;
  } catch (_) {
    result.reason = "compress-failed";
    return result;
  } finally {
    // ImageBitmap holds its pixels outside the JS heap and is not reclaimed by
    // ordinary garbage collection.
    if (source && typeof source.close === "function") source.close();
  }
}
