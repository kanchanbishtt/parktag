import { createHash } from "node:crypto";
import fs from "node:fs/promises";

// A weak validator: the same page is sent identity-encoded, gzipped or
// brotli'd, and a weak ETag is the one that is honest across all three.
export function etagFor(text) {
  return `W/"${createHash("sha1").update(text).digest("hex")}"`;
}

// Does an If-None-Match header accept this ETag? Weak comparison, as RFC 9110
// prescribes for If-None-Match, and `*` matches anything.
export function matchesEtag(header, etag) {
  if (!header) return false;
  const bare = (tag) => tag.trim().replace(/^W\//, "");
  return String(header)
    .split(",")
    .some((tag) => tag.trim() === "*" || bare(tag) === bare(etag));
}

// Reads a file, applies `transform` (asset stamp, env placeholders) and, when
// `memoize` is on, keeps the result together with its ETag so later requests
// never touch the disk or redo the substitution. Off in dev, so an edit shows
// on the next reload. Returns { body, etag }.
export function createRenderedFileStore({ memoize, transform = (text) => text }) {
  const cache = new Map();

  return async function load(file) {
    if (memoize) {
      const hit = cache.get(file);
      if (hit) return hit;
    }
    const body = transform(await fs.readFile(file, "utf8"));
    const entry = { body, etag: etagFor(body) };
    if (memoize) cache.set(file, entry);
    return entry;
  };
}
