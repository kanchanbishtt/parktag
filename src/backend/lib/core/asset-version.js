// One stamp for every versioned asset URL, computed from what is on disk.
//
// Static assets were served with `maxAge: 0` and no ETag, so every visit
// re-downloaded every stylesheet, script and image in full. The obvious fix —
// a long max-age — is unsafe here because the assets are not content-hashed:
// `/styles/styles.css` keeps its name across deploys, so a browser holding a
// cached copy would keep serving last week's CSS.
//
// The way out is to put the version in the URL and let the URL change when the
// bytes do. Two hand-bumped constants ("parktag-ui-10", "hub-shell-1") already
// did this for the scanner and hub pages, but a constant someone has to
// remember to bump is exactly the thing that goes stale — and it becomes far
// more dangerous once a matching URL is cached for a year. So the stamp is
// derived from the files themselves: change a script, the digest changes, every
// versioned URL changes with it, and no one has to remember anything.
//
// Only /styles and /scripts are hashed. Images are not referenced with a
// version, and folding them in would mean a new banner silently invalidated
// every stylesheet and script as well.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// The directories whose contents a versioned URL can point at.
const VERSIONED_DIRS = ["styles", "scripts"];

// Long enough that an accidental collision is not a thing that happens, short
// enough to stay readable in a URL and in a log line.
const DIGEST_LENGTH = 12;

async function listFilesUnder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A missing directory is not fatal — it just contributes nothing.
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFilesUnder(full)));
    } else if (entry.isFile()) {
      found.push(full);
    }
  }
  return found;
}

// A digest of every file a versioned URL can resolve to. Paths are hashed
// alongside the bytes so that renaming a script changes the stamp even when its
// contents are untouched, and the list is sorted so two machines with the same
// files agree — instances behind a load balancer must produce the same stamp or
// they would hand out URLs each other refuses to treat as current.
export async function computeAssetVersion(frontendRoot) {
  const files = [];
  for (const dir of VERSIONED_DIRS) {
    files.push(...(await listFilesUnder(path.join(frontendRoot, dir))));
  }
  files.sort();

  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(path.relative(frontendRoot, file).split(path.sep).join("/"));
    digest.update("\0");
    digest.update(await readFile(file));
    digest.update("\0");
  }
  return digest.digest("hex").slice(0, DIGEST_LENGTH);
}

// Never let a failure here take the app down, and never let it fail towards
// staleness. A per-boot value is wrong only in that it wastes a cache: every
// URL looks new, so everything is fetched once more than it needed to be. That
// is the right direction to fail in — the alternative is serving a year-old
// stylesheet.
export async function resolveAssetVersion(frontendRoot, log) {
  try {
    return await computeAssetVersion(frontendRoot);
  } catch (error) {
    const fallback = createHash("sha256")
      .update(`boot:${process.pid}:${Date.now()}`)
      .digest("hex")
      .slice(0, DIGEST_LENGTH);
    log?.warn?.(
      { event: "asset-version-fallback", err: error, fallback },
      "[assets] could not hash the asset tree; using a per-boot stamp, caches will miss"
    );
    return fallback;
  }
}

const ONE_YEAR = 31536000;
const ONE_DAY = 86400;

// What a static file may be cached for.
//
// The rule that makes the whole scheme safe is the first one: a URL is only
// treated as immutable when the version on it is the version this process
// actually computed. Anything else — a stale stamp from a page that was cached
// before the last deploy, or an unsubstituted `__ASSET_VERSION__` literal from
// a page served straight off disk — falls through to revalidation. So the worst
// a wrong stamp can cost is a conditional request, never a year of stale CSS.
export function cacheControlFor({ pathname, requestedVersion, assetVersion }) {
  if (requestedVersion && assetVersion && requestedVersion === assetVersion) {
    return `public, max-age=${ONE_YEAR}, immutable`;
  }

  // Artwork is the heavy, stable half of the tree and is not versioned, so it
  // gets a bounded window rather than a year. The convention the repo already
  // follows is to give changed artwork a new filename (shop-car.webp,
  // verify-vehicle.webp), which sidesteps this entirely; a file replaced in
  // place is the only case that waits, and it waits a day, not a release cycle.
  if (pathname.startsWith("/images/")) {
    return `public, max-age=${ONE_DAY}`;
  }

  // Everything else keeps its name across deploys, so it must be asked about
  // every time. The saving here is the body, not the round trip: an unchanged
  // file comes back as a 304 with no payload instead of the whole thing.
  return "public, max-age=0, must-revalidate";
}
