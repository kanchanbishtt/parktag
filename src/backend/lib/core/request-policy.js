// Small path rules that app.js applies at several layers: which requests are
// too noisy to log, which are exempt from the global rate limit, and which
// files the static handler may serve at all.

// Where the static handler serves assets from. A first load of a page fetches
// 30 to 50 of these, so they must not count against a visitor's request budget
// (a carrier NAT shares one IP across many phones) or fill the logs.
const STATIC_ASSET = /^\/(images|styles|scripts|fonts)\//;

export function pathnameOf(url) {
  const raw = String(url || "");
  const cut = raw.search(/[?#]/);
  return cut === -1 ? raw : raw.slice(0, cut);
}

export function isStaticAssetUrl(url) {
  return STATIC_ASSET.test(pathnameOf(url));
}

// Requests that add nothing to the access log or the rate limit: assets, and
// the health check a monitor calls every few seconds.
export function isQuietUrl(url) {
  const pathname = pathnameOf(url);
  return STATIC_ASSET.test(pathname) || pathname === "/api/health";
}

// The static root is the whole frontend folder, which includes `pages/`: the
// raw HTML shells. Those must only ever be reached through their named routes,
// which apply the per-page CSP and no-store headers and stamp the asset
// version. Served raw they skipped all three (and an admin shell was readable
// without a session). `allowedPath` for @fastify/static: false is a 404.
//
// The path is decoded and normalised first, because the static handler decodes
// it later: /%70ages/... and /pages/../pages/... must not slip past a plain
// prefix test. Anything undecodable is refused.
export function isPublicStaticPath(pathName) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(pathName));
  } catch {
    return false;
  }
  const normalised = decoded.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  const segments = [];
  for (const part of normalised.split("/")) {
    if (part === "..") segments.pop();
    else if (part !== "." && part !== "") segments.push(part.toLowerCase());
  }
  return segments[0] !== "pages";
}
