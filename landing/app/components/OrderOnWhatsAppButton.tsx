"use client";

// Third buy path, alongside APP_URL/shop (ours, fully instrumented) and Amazon.
// Like Amazon, the visitor leaves for a surface we do not instrument, so
// order_on_whatsapp is the last event we will ever see on this journey — the
// order itself is agreed in a chat.
//
// Same support number the scanner and contact page use. Env-overridable so a
// change of business line is a Railway variable, not a deploy.
const WHATSAPP_NUMBER =
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "918791638854";

// Pre-filled so the visitor does not have to explain themselves and we can tell
// an order intent apart from a support message at a glance in the inbox.
const MESSAGE = "Hi ParkTag, I'd like to order a QR sticker for my car.";

const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(MESSAGE)}`;

function WhatsAppGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="w-[16px] h-[16px] shrink-0"
    >
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.64-1.03-5.13-2.9-7A9.82 9.82 0 0 0 12.04 2Zm0 18.02h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.37c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.22-8.24 8.22Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07 0 1.22.89 2.4 1.02 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.14.16 1.57.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

export function OrderOnWhatsAppButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <a
      href={WHATSAPP_URL}
      style={style}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        // Never block the navigation on analytics. ptTrack is a no-op when the
        // bundle has not loaded or consent was withheld.
        window.ptTrack?.("order_on_whatsapp", { method: "whatsapp", quantity: 1 });
      }}
      className={
        className ??
        "inline-flex items-center justify-center gap-2 border-2 border-[#03162D] text-[#03162D] font-bold px-6 py-3 rounded-xl hover:bg-[#03162D] hover:text-white transition-colors text-sm"
      }
    >
      <WhatsAppGlyph />
      Order on WhatsApp
    </a>
  );
}
