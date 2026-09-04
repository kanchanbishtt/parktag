"use client";

// Replaces the inline "Order on WhatsApp" button, which appeared three times —
// desktop nav, mobile menu, hero — competing with Get Started and Buy on Amazon
// at every one of them. Four buy buttons above the fold is not four
// opportunities, it is a visitor deciding nothing. As a bubble it is available
// on every page and every scroll position while taking part in none of those
// decisions.
//
// No QR card above it. A QR is for handing your screen to someone else's
// camera; a visitor already holding the device it is displayed on cannot scan
// it, so on a website it is decoration that looks like a feature.
const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "918791638854";

const MESSAGE = "Hi ParkTag, I'd like to order a QR sticker for my car.";

// The green off the product itself, not WhatsApp's brand green. Sampled from
// the WHATSAPP button on sticker-artwork-front-back.png, where #0E8D00 accounts
// for 16,082 pixels of the pill.
//
// Shipped one step darker than sampled, at #0E8A00. White 14px bold on the
// exact #0E8D00 measures 4.35:1, just under the 4.5:1 WCAG AA minimum for text
// below 18.66px; #0E8A00 measures 4.51:1 and is three units of green away from
// the source, which is not a difference anyone can see next to the sticker.
// WhatsApp's own #25D366 was what this used before and is 1.98:1 — badly
// illegible in white, which is why their brand guidance pairs it with dark text.
const GREEN = "#0E8A00";
const GREEN_HOVER = "#0B7300";

const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(MESSAGE)}`;

declare global {
  interface Window {
    ptTrack?: (name: string, params?: Record<string, unknown>) => void;
  }
}

function WhatsAppGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[22px] h-[22px] shrink-0"
    >
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function WhatsAppBubble() {
  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      // The visible text reads "WhatsApp Us", which is not what this does — it
      // opens an order conversation. Screen readers get the honest version.
      aria-label="Order on WhatsApp"
      onClick={() => {
        // Same event the inline button fired, so the conversion history is
        // continuous across this change rather than restarting at zero.
        window.ptTrack?.("order_on_whatsapp", { method: "whatsapp", quantity: 1 });
      }}
      // Positioning belongs to FloatingActions now; this is just the control.
      //
      // A circle on a phone, where horizontal space is the scarce thing and an
      // icon everybody already recognises does not need a caption. The label
      // grows in from zero width once there is room, animated rather than
      // snapped so a resize looks intentional instead of like a reflow bug.
      className="
        group inline-flex items-center
        rounded-full
        h-[52px] pl-[14px] pr-[14px] sm:pr-5
        text-white font-bold text-sm
        shadow-lg shadow-black/25
        border-2 border-white/90
        transition-colors
        focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/50
      "
      style={{ backgroundColor: GREEN }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = GREEN_HOVER; }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = GREEN; }}
    >
      <WhatsAppGlyph />
      <span
        className="
          overflow-hidden whitespace-nowrap
          max-w-0 sm:max-w-[8rem]
          opacity-0 sm:opacity-100
          ml-0 sm:ml-2.5
          transition-all duration-300 ease-out
        "
      >
        WhatsApp Us
      </span>
    </a>
  );
}
