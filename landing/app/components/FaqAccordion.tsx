"use client";

import { useState } from "react";

const FAQS = [
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
    q: "How long does delivery take?",
    a: "We ship within 1–2 business days. Delivery takes 2–4 business days across India. A tracking number is sent once dispatched.",
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
