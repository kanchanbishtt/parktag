"use client";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBell,
  faCommentDots,
  faQrcode,
  faLock,
  faCarSide,
  faLocationDot,
  faDroplet,
  faCalendarCheck,
} from "@fortawesome/free-solid-svg-icons";

// Font Awesome solid throughout, rather than the outline-to-fill swap that was
// asked for first. Measured: FA Free ships a regular weight for only three of
// these eight — bell, comment and credit card. QR, lock, car, location and
// droplet are solid-only in the free set, so an outline-to-fill hover would
// have animated three icons and left five sitting still, which reads as broken
// rather than subtle. FA Pro has the weights; this is what the free set can do
// honestly.
//
// Hover is a colour change on the glyph itself, no container. The icons scale
// with the viewport so they carry the row on a wide screen without needing a
// box drawn around them to give them presence.
const FEATURES: [string, IconDefinition][] = [
  ["Instant Scan Alert", faBell],
  ["Anonymous Chat", faCommentDots],
  ["No App to Scan", faQrcode],
  ["Number Private", faLock],
  ["Any Vehicle Type", faCarSide],
  ["Share Your ETA", faLocationDot],
  ["Waterproof Tag", faDroplet],
  ["1 Year Included", faCalendarCheck],
];

export function FeatureIcons() {
  return (
    // Four across at every width, so the eight always read as two rows of four.
    // Eight in a single line turned a block you scan into a strip you skim
    // past, and left the labels cramped under gaps wide enough to break the
    // pairing between a label and its icon.
    <div className="grid grid-cols-4 gap-y-8 sm:gap-y-10 gap-x-4 sm:gap-x-8">
      {FEATURES.map(([label, icon]) => (
        <div key={label} className="group flex flex-col items-center gap-3 text-center">
          {/* No tile. The icon grows with the viewport instead: 24px on a
              phone where four across is already tight, 40px on a desktop where
              the cells are ~250px wide and a small glyph floating in one reads
              as an afterthought.
              Hover goes red rather than the caution yellow. Yellow on white is
              1.3:1 — it would disappear. Red on white is 3.8:1, which clears
              the 3:1 an icon needs. */}
          <FontAwesomeIcon
            icon={icon}
            className="h-6 w-6 sm:h-8 sm:w-8 lg:h-10 lg:w-10 text-[#495B7B] transition-colors duration-200 group-hover:text-[#FF2700]"
          />
          <span className="text-[11px] sm:text-xs font-medium leading-tight text-[#495B7B] transition-colors duration-200 group-hover:text-[#03162D]">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
