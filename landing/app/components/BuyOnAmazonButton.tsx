"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faAmazon } from "@fortawesome/free-brands-svg-icons";

// Secondary buy path. The primary one is APP_URL/shop, which we own end to end
// and which fires begin_checkout and purchase. This one leaves for Amazon, so
// buy_on_amazon is the last event we will ever see on the journey — Amazon does
// not host our tags and the order is only visible in Amazon Attribution.
//
// The href is an env var rather than a constant because the URL that ships is
// meant to be an Amazon Attribution link (the plain /dp/ URL below is the
// fallback, and it reports nothing back). Swapping it is a Railway variable
// change, not a deploy of new code.
const AMAZON_URL =
  process.env.NEXT_PUBLIC_AMAZON_URL ?? "https://www.amazon.in/dp/B0HHG5KKJS";

declare global {
  interface Window {
    ptTrack?: (name: string, params?: Record<string, unknown>) => void;
  }
}

export function BuyOnAmazonButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <a
      href={AMAZON_URL}
      style={style}
      target="_blank"
      // noopener because target="_blank" otherwise hands Amazon a live
      // window.opener back into this page.
      rel="noopener noreferrer"
      onClick={() => {
        // Never block or delay the navigation on analytics. ptTrack is a no-op
        // if the bundle has not loaded or consent was withheld, and the anchor
        // is a real href so the click works with JS off entirely.
        window.ptTrack?.("buy_on_amazon", { method: "amazon", quantity: 1 });
      }}
      className={
        className ??
        "inline-flex items-center justify-center gap-2 border-2 border-[#FF2700] text-[#FF2700] font-bold px-6 py-3 rounded-xl hover:bg-[#FF2700] hover:text-white transition-colors text-sm"
      }
    >
      <FontAwesomeIcon icon={faAmazon} className="w-4 h-4 shrink-0" />
      Buy on Amazon
    </a>
  );
}
