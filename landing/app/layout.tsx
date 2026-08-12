import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ParkTag | Smart Parking. Instant Connection.",
  description:
    "QR-based vehicle identification for modern India. Scan a tag, reach the owner instantly, no app needed to scan.",
  metadataBase: new URL("https://parktag.me"),
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
