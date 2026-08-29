import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

/**
 * Records where landing-page traffic comes from.
 *
 * This runs on the server, on the request the visitor already made. It asks the
 * browser for nothing: no `navigator.geolocation` prompt, no cookie, no
 * client-side script. The visitor's IP — which the server receives either way,
 * as every server does — is forwarded to the API, resolved there to a
 * country/region/city, and then discarded. See
 * src/backend/routes/system/analytics.js for exactly what gets stored.
 *
 * A location PERMISSION prompt would answer the same question far worse: most
 * visitors decline it, so the sample would be small and self-selected, and GPS
 * precision is far more personal data than "which city" requires.
 *
 * Nothing here may affect what the visitor sees. Every path returns
 * NextResponse.next(), the beacon is fired inside event.waitUntil() so the
 * response is never delayed by it, and every failure is swallowed.
 */

const APP_URL = (
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://app.parktag.me"
).replace(/\/+$/, "");

const INGEST_KEY = process.env.ANALYTICS_INGEST_KEY ?? "";

// Matched here as well as server-side. Filtering at this end means a crawler
// never costs an API call or a geo lookup in the first place.
const BOT_PATTERN =
  /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|embedly|quora link preview|pinterest|semrush|ahrefs|mj12|dotbot|petalbot|headlesschrome|lighthouse|gtmetrix|uptime|pingdom|curl\/|wget|python-requests|axios\/|go-http-client|okhttp/i;

/**
 * The visitor's address.
 *
 * Railway's edge rewrites `x-forwarded-for` rather than appending to whatever
 * the client sent, so the FIRST entry is the real client and everything after
 * it is the proxy chain. Only the first is read.
 */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() ?? "";
}

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const response = NextResponse.next();

  // Unconfigured means off. Nothing is sent anywhere until a key is set on both
  // services, so a fork or a preview deploy reports nothing by default.
  if (!INGEST_KEY) return response;

  try {
    const userAgent = request.headers.get("user-agent") ?? "";
    if (!userAgent || BOT_PATTERN.test(userAgent)) return response;

    // Next prefetches links on hover. Counting those would inflate every page
    // the visitor merely pointed at but never opened.
    if (
      request.headers.get("next-router-prefetch") ||
      request.headers.get("purpose") === "prefetch" ||
      request.headers.get("x-purpose") === "preview"
    ) {
      return response;
    }

    const beacon = fetch(`${APP_URL}/api/analytics/landing-visit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-parktag-analytics-key": INGEST_KEY,
      },
      body: JSON.stringify({
        path: request.nextUrl.pathname,
        referrer: request.headers.get("referer") ?? "",
        ip: clientIp(request),
        userAgent,
      }),
      // The API being slow or down must not hold a page open.
      signal: AbortSignal.timeout(3000),
      // Never let a beacon response be served from, or written to, any cache.
      cache: "no-store",
    }).catch(() => {
      // Deliberately silent. A failed analytics write is not worth a log line
      // on every request, and there is nothing to retry.
    });

    // Hands the request off so the visitor's response is not waiting on ours.
    event.waitUntil(beacon);
  } catch {
    // Any unexpected failure above is analytics-only. The page still renders.
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Page navigations only. Without this the beacon would fire for every
     * script, font and image on the page and each visit would be counted dozens
     * of times.
     *
     * Excluded: Next's build output and image optimiser, the metadata routes,
     * and anything with a file extension.
     */
    "/((?!_next/static|_next/image|api/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.[\\w]+$).*)",
  ],
};
