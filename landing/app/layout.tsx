import type { Metadata } from "next";
import Script from "next/script";
import { preconnect } from "react-dom";
import "./globals.css";

// Font Awesome injects its own <style> at runtime, which in an SSR app lands
// after first paint and shows every icon at full unstyled size for a frame.
// Importing the stylesheet and switching autoAddCss off is the documented fix.
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
config.autoAddCss = false;
import { FloatingActions } from "./components/FloatingActions";

export const metadata: Metadata = {
  title: "ParkTag | Smart Parking. Instant Connection.",
  description:
    "QR-based vehicle identification for modern India. Scan a tag, reach the owner instantly, no app needed to scan.",
  metadataBase: new URL("https://parktag.me"),
  // One canonical address for every page.
  //
  // www.parktag.me and parktag.me both answer 200 with identical content and
  // the same ETag, so the site lives at two addresses and search engines split
  // its ranking across them. "./" resolves against metadataBase and the current
  // path, so every page points at its own apex URL.
  //
  // A www -> apex redirect was the obvious alternative and was rejected after
  // testing: Next applies redirects() BEFORE headers(), so a 308 goes out with
  // no headers on it at all — no HSTS included. www would then never be pinned
  // to HTTPS in any browser, leaving http://www.parktag.me strippable forever.
  // Serving www a real page with the full header set, and naming the apex as
  // canonical, keeps the TLS posture and fixes the duplicate-content half.
  // Folding www into the apex properly belongs at DNS/Railway, where the
  // redirect can carry HSTS of its own.
  alternates: { canonical: "./" },
  keywords: ["parktag", "smart parking", "QR code", "vehicle", "India", "parking tag"],
  openGraph: {
    title: "ParkTag | Smart Parking. Instant Connection.",
    description: "No more blocked driveways. Scan. Connect. Resolve.",
    url: "https://parktag.me",
    siteName: "ParkTag",
    type: "website",
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: "ParkTag | Smart Parking. Instant Connection.",
    description: "No more blocked driveways. Scan. Connect. Resolve.",
  },
};

// The landing site loads the SAME analytics bundle the app serves, rather than
// carrying its own copy of the gtag/fbq boilerplate. That keeps the measurement
// IDs, the event map and the PII allow-list in exactly one file, so the two
// deploys can never drift into reporting different things under the same name.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Open the connection to the app origin early: the analytics bundle and every
  // buy link go there.
  preconnect(new URL(APP_URL).origin);
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {children}
        {/*
          Loaded async via next/script, after the window load event so it does not
          compete with the hero for bandwidth. Nothing in this site calls
          window.ptTrack before then: every call is a click handler behind `?.`.
          analytics.js reads its surface from
          document.currentScript, which is null for an async script — that is
          fine here and only here, because its fallback is "app", which is what
          the marketing site is. The app's own pages load the same file with a
          synchronous tag so they can declare data-surface="scanner", which is
          the one place the fallback would be wrong.
        */}
        {/* Mounted in the layout, not the page: the WhatsApp route should be
            reachable from /about, /contact and the policy pages too, which is
            where somebody with a question actually ends up. */}
        <FloatingActions />
        <Script src={`${APP_URL}/pt-analytics.js`} strategy="lazyOnload" />
      </body>
    </html>
  );
}
