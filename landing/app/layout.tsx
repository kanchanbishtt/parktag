import type { Metadata } from "next";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {children}
        {/*
          Navigation buttons fade the page out by setting document.body opacity
          to 0 right before leaving. When the browser restores this page from the
          back/forward cache (the Back button), that inline opacity:0 is preserved
          — so the landing page came back fully invisible (a blank white screen).
          `pageshow` fires on every display, including a bfcache restore, so we
          clear the fade there to guarantee the page is visible again.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.addEventListener('pageshow',function(){var b=document.body;if(b){b.style.transition='';b.style.opacity='';}});",
          }}
        />
      </body>
    </html>
  );
}
