"use client";

const ITEMS = [
  "No app needed to scan",
  "Number never shared",
  "Works on any phone",
  "Waterproof QR tag",
  "Ships in 24 hours",
  "One-time payment",
  "Any vehicle type",
  "Anonymous messaging",
  "Instant notifications",
  "Privacy by design",
];

export function Marquee() {
  const repeated = [...ITEMS, ...ITEMS];

  return (
    <div className="bg-[#03162D] border-y border-white/8 py-3.5 overflow-hidden select-none">
      <div
        className="flex whitespace-nowrap"
        style={{ animation: "marquee 32s linear infinite" }}
      >
        {repeated.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-3 px-7 text-[13px] text-white/45 font-medium tracking-wide flex-shrink-0"
          >
            <span className="w-[5px] h-[5px] rounded-full bg-[#1A9D20] inline-block flex-shrink-0" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
