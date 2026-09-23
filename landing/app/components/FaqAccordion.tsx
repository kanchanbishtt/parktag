"use client";

import { useState } from "react";

const FAQS = [
  {
    q: "Are WhatsApp scan notifications a Premium feature?",
    a: "No. WhatsApp scan notifications are included for the life of every active ParkTag. The first included year covers Premium tools such as masked calls, callback, scanner location details, the document vault and SOS features.",
  },
  {
    q: "Do I have to stick the ParkTag directly on my car?",
    a: "No. With the Duo Pack you can add the optional Clear Dashboard Plate for ₹49: 10 × 6 cm, 2 mm clear crystal acrylic. Stick your ParkTag on the plate, then place it on your dashboard instead of sticking it on the windscreen. It is never added automatically.",
  },
  {
    q: "How does ParkTag work?",
    a: "You place a QR sticker on your vehicle. When someone scans it with any phone camera, you get notified instantly and can communicate anonymously through the ParkTag platform, without revealing your phone number.",
  },
  {
    q: "Does the person scanning need an app?",
    a: "No. The scanner just uses their phone camera, it opens a webpage directly. No app, no sign-up, no friction. Only you (the vehicle owner) use the ParkTag app.",
  },
  {
    q: "Will my phone number be shared?",
    a: "Never. Your name, number, and address are never visible to anyone who scans your tag. All contact goes through our anonymous platform.",
  },
  {
    q: "What if I lose the sticker?",
    a: "Email us at support@parktag.me. You can deactivate the old tag instantly from the app, and we'll send you a replacement.",
  },
  {
    q: "Which vehicles can use ParkTag?",
    a: "Any vehicle: cars, bikes, scooters, EVs, autos, trucks, bicycles. If it parks, it can use ParkTag.",
  },
  {
    // The one thing a buyer is entitled to know before paying and could not
    // find anywhere on this site. Every tag includes a year of masked calling;
    // what happens on day 366 was documented only in the backend.
    //
    // Worth being exact about what lapses, because it is narrower than it
    // sounds and the honest version is the better one: callEntitlement()
    // returns masking:false for a lapsed tag, and masking:false blocks the call
    // — it does not place an unmasked one. The scanner is told "Calling isn't
    // available for this vehicle right now. You can still leave a message."
    // The number is never exposed in any tier, so this answer does not walk
    // back the "Will my phone number be shared? Never." answer above it.
    //
    // No renewal price is quoted because there is no renewal to buy yet: there
    // is no checkout and no billing job behind tag.callSubscription. Naming a
    // figure here would be inventing one.
    q: "What happens after the first year?",
    a: "Every tag includes one year of Premium. After that, the tag keeps working, WhatsApp scan notifications remain included, and your number stays private. Premium tools such as masked calling pause until you extend Premium from your dashboard.",
  },
  {
    // The refund policy already covers defects; it was reachable only from a
    // footer link, which is not where somebody weighing up ₹499 is looking.
    q: "What if the tag arrives damaged or faulty?",
    a: "Tell us within 7 days of delivery with an unboxing photo or video and your order ID, and we will replace it. Unused, unscanned tags in their original packaging can also be returned within 7 days. Approved refunds go back to the original payment method in 7–10 business days.",
  },
  {
    q: "How long does delivery take?",
    // COD is quoted only for the car packs because those are the only packs
    // the guest checkout offers it on, and "where available" because a PIN code
    // Delhivery cannot collect cash at is refused at checkout.
    a: "Delivery is free on every order, anywhere in India. We ship within 1–2 business days and delivery takes 2–4 business days, with a tracking number once dispatched. Cash on delivery is available on the Car Tag packs for a ₹30 COD fee on MRP (₹329 for one tag, ₹529 for two) where Delhivery accepts cash. The ₹399 launch price and other codes apply to online payment only.",
  },
];

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {FAQS.map(({ q, a }, i) => (
        <div key={q} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-6 py-4 font-semibold text-[#03162D] text-sm text-left cursor-pointer select-none"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span>{q}</span>
            <span
              className="text-[#FF2700] text-xl font-bold ml-4 flex-shrink-0 transition-transform duration-200"
              style={{ transform: open === i ? "rotate(45deg)" : "rotate(0deg)" }}
            >
              +
            </span>
          </button>
          <div
            style={{
              display: "grid",
              gridTemplateRows: open === i ? "1fr" : "0fr",
              transition: "grid-template-rows 320ms cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          >
            <div style={{ overflow: "hidden" }}>
              <div
                className="px-6 pb-5 text-[#495B7B] text-sm leading-relaxed"
                style={{
                  opacity: open === i ? 1 : 0,
                  transform: open === i ? "translateY(0)" : "translateY(-6px)",
                  transition: "opacity 280ms ease, transform 280ms ease",
                }}
              >
                {a}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
