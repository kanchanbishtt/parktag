import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy for the marketing site.
//
// Everything this site loads is same-origin — no CDN, no web fonts, no
// analytics — so `default-src 'self'` holds and each directive below only
// widens it where the framework genuinely needs it.
//
// `'unsafe-inline'` is required in both script-src and style-src: Next streams
// hydration data through inline <script> tags, and <AnimateIn> animates via a
// `style` attribute. Nonces would be stricter but need a request-time
// middleware, which this fully static site otherwise does without.
const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is dev-only: Turbopack's HMR client evaluates modules.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // ws:/wss: are dev-only, for the HMR socket.
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
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
  async headers() {
    return [
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
};

export default nextConfig;
