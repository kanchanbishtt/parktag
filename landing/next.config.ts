import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy for the marketing site.
//
// `'unsafe-inline'` is required in both script-src and style-src: Next streams
// hydration data through inline <script> tags, and <AnimateIn> animates via a
// `style` attribute. Nonces would be stricter but need a request-time
// middleware, which this fully static site otherwise does without.
//
// This policy used to say "everything is same-origin — no analytics" and be
// right about it. It stopped being right the moment the analytics bundle was
// added, and the result was silent: the browser blocked GA4 and the Meta Pixel
// with no server-side error and no failed request anyone was watching. The tag
// was present in the HTML, the IDs were correct, and nothing was ever reported.
// A CSP that lags the code it protects fails exactly this way.
//
// The app's own origin has to be listed because the bundle is served from
// app.parktag.me, not from here — a cross-origin script, which `'self'` alone
// does not cover.
// Normalised to a bare origin. A CSP source expression that carries a path —
// which "https://app.parktag.me/" with its trailing slash is — matches only
// that path, so the bundle at /pt-analytics.js would be blocked and the policy
// would look correct while doing nothing. Env values pick up trailing slashes
// routinely, so this cannot rely on whoever sets it being careful.
const APP_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";
  try {
    return new URL(raw).origin;
  } catch {
    return "https://app.parktag.me";
  }
})();

// Where GA4 and the Meta Pixel fetch their code, and where they report to.
// Split out so the app's CSP (src/backend/app.js) can be read against the same
// list; the two are separate policies on separate services and drifting apart
// is how one of them silently stops collecting.
const ANALYTICS_SCRIPT = `${APP_ORIGIN} https://www.googletagmanager.com https://connect.facebook.net`;
const ANALYTICS_CONNECT =
  "https://*.google-analytics.com https://*.analytics.google.com " +
  "https://*.googletagmanager.com https://www.facebook.com https://connect.facebook.net";
const ANALYTICS_IMG =
  "https://*.google-analytics.com https://*.googletagmanager.com https://www.facebook.com";

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is dev-only: Turbopack's HMR client evaluates modules.
  `script-src 'self' 'unsafe-inline' ${ANALYTICS_SCRIPT}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${ANALYTICS_IMG}`,
  "font-src 'self' data:",
  // ws:/wss: are dev-only, for the HMR socket.
  `connect-src 'self' ${ANALYTICS_CONNECT}${isDev ? " ws: wss:" : ""}`,
  // blob: covers the camera preview in the tag scanner.
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Clickjacking defence. This page asks for camera permission, so it must not
  // be framable by another site. VS Code's Simple Browser is allowed in dev
  // only, matching how the backend handles the same workflow.
  `frame-ancestors 'self'${isDev ? " vscode-webview: https://*.vscode-cdn.net" : ""}`,
  // Omitted in dev: it would rewrite http://localhost requests to https.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // camera=(self) is required — the tag scanner needs it. The rest are denied.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-braces alongside frame-ancestors, for older browsers.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Drop `X-Powered-By: Next.js`. It tells anyone who asks which framework and
  // therefore which CVE list to work through, and buys nothing in return. The
  // backend has never sent it (helmet removes it there); this site did.
  poweredByHeader: false,
  async headers() {
    return [
      // How long a shared cache may hold a PAGE.
      //
      // Next stamps every prerendered route with `s-maxage=31536000` — one
      // year. Nothing in front of the app honours it today (responses come back
      // without an `age` header, so Railway's edge is routing, not caching), and
      // Next's own cache is rebuilt by each deploy, so the site has never
      // actually gone stale. It is a landmine rather than a live bug: put a CDN
      // in front — Cloudflare, or Railway turning caching on — and /privacy,
      // /terms and /refund freeze for a year at whatever they said that day.
      // Those three carry legal weight, and a correction that cannot propagate
      // is the kind of problem discovered from a complaint.
      //
      // Ten minutes at a shared cache with a day of stale-while-revalidate: a
      // CDN still answers instantly from cache and refreshes behind the request,
      // so this costs nothing and the year-long tail is gone. `max-age=0` keeps
      // browsers revalidating, which they already do — there is no max-age in
      // the current header for them to hold on to.
      //
      // Listed route by route ON PURPOSE, not as a wildcard: /_next/static
      // holds content-hashed bundles serving `max-age=31536000, immutable`, and
      // that is exactly right for them. A pattern that swept those up would
      // trade a theoretical staleness bug for a real performance regression on
      // every page load.
      {
        source: "/:path(|about|contact|privacy|terms|refund)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=600, stale-while-revalidate=86400",
          },
        ],
      },
      {
        source: "/:path*",
        headers: isDev
          ? securityHeaders
          : [
              ...securityHeaders,
              // Only meaningful over TLS; browsers ignore it on plain http.
              {
                key: "Strict-Transport-Security",
                value: "max-age=31536000; includeSubDomains",
              },
            ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/brand-guideline", destination: "/brand-guideline/index.html" },
    ];
  },
};

export default nextConfig;
