"use client";

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

function AmazonGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[16px] h-[16px] shrink-0"
    >
      <path d="M6 2h12l1 6H5z" />
      <path d="M5 8h14v12H5z" />
      <path d="M10 12h4" />
    </svg>
  );
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
        "inline-flex items-center justify-center gap-2 border-2 border-[#03162D] text-[#03162D] font-bold px-6 py-3 rounded-xl hover:bg-[#03162D] hover:text-white transition-colors text-sm"
      }
    >
      <AmazonGlyph />
      Buy on Amazon
    </a>
  );
}
