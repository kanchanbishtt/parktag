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
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
