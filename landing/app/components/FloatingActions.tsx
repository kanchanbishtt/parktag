"use client";

import { ScanTagButton } from "./ScanTagButton";
import { WhatsAppBubble } from "./WhatsAppBubble";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

// The persistent pair, bottom right on every page.
//
// These are the two things a visitor might need at any scroll position and
// which the page cannot otherwise offer once the hero is gone: scan a tag you
// are standing in front of, and ask a question. Neither is the sale, which is
// why they live down here rather than competing with Buy now in the hero.
//
// Scan takes the brand red because it is the prominent one of the pair and red
// is the only accent the guideline allows. WhatsApp keeps green: it is a
// third-party mark and readers identify it by colour, so recolouring it to
// brand would make it stop reading as WhatsApp at 40px.
export function FloatingActions() {
  return (
    // z-40 sits above the page and deliberately below the scanner overlay at
    // z-[100], so the cluster is not floating over its own open camera.
    // Full width so Scan sits in the middle of the viewport rather than in the
    // middle of the pair — with WhatsApp beside it in a flex row, centring the
    // row pushed Scan off-centre by half the bubble. WhatsApp is taken out of
    // the flow and pinned right instead, so the primary control lands on the
    // device's centre line at every width.
    //
    // pointer-events-none on the strip because it spans the whole screen and
    // would otherwise swallow every click along the bottom of the page; the two
    // controls opt back in.
    <div
      className="fixed inset-x-0 z-40 flex items-center justify-center px-5 pointer-events-none"
      style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
    >
      <ScanTagButton
        appUrl={APP_URL}
        label="Scan QR to Call"
        className="
          pointer-events-auto
          group inline-flex items-center gap-2.5
          rounded-full bg-[#FF2700] hover:bg-[#D92200]
          pl-5 pr-6 py-3.5
          text-white font-bold text-sm sm:text-base
          shadow-[0_4px_16px_rgba(255,39,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,39,0,0.45)]
          transition-all
          focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/40
        "
      />
      <div className="pointer-events-auto absolute right-5">
        <WhatsAppBubble />
      </div>
    </div>
  );
}
