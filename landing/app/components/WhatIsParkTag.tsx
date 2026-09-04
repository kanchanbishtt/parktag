import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faCarSide,
  faLightbulb,
  faTruckPickup,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { SectionLabel } from "./SectionLabel";

// Replaces the eight-icon "Some Special Features" strip.
//
// That strip listed properties — Waterproof Tag, Any Vehicle Type, Instant Scan
// Alert — to somebody who did not yet know what the object was. Eight abstract
// nouns in two rows, no heading, no sentence, and the reader still could not
// have told you what ParkTag is afterwards.
//
// These are the four moments the product exists for instead. A scenario tells
// you what it is and when you would want one in the same breath, which a
// property cannot: "Waterproof Tag" answers a question nobody has asked yet.
//
// All four come from the product's own reasons list, the same set the scanner
// page offers a stranger when they scan a tag.
const CASES: [IconDefinition, string, string][] = [
  [faCarSide, "Blocked in", "They ask you to move, without calling out your number"],
  [faLightbulb, "Lights left on", "A stranger can warn you before the battery dies"],
  [faTruckPickup, "Parked wrong", "Traffic police reach you before the tow truck does"],
  [faTriangleExclamation, "Emergency", "Your emergency contact is reachable from the tag"],
];

export function WhatIsParkTag() {
  return (
    <section id="features" className="bg-white py-20 sm:py-28">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">

        <p className="mb-5"><SectionLabel>What is ParkTag?</SectionLabel></p>
        <h2 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-4 tracking-tight leading-tight">
          A sticker that makes your<br className="hidden sm:block" /> vehicle reachable.
        </h2>
        <p className="text-[#495B7B] leading-relaxed max-w-2xl mb-12">
          A QR tag on your glass. Anyone who needs to reach you about the vehicle
          scans it and gets through by call or WhatsApp. Your number is never
          shown to them.
        </p>

        {/* A bordered grid rather than eight icons floating in space. The cell
            edges do the grouping, so each scenario reads as its own thing
            instead of as one item in a run-on list. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-gray-200 rounded-2xl overflow-hidden">
          {CASES.map(([icon, title, body], i) => (
            <div
              key={title}
              className={
                "flex flex-col items-center text-center px-6 py-9 " +
                // Internal rules only, never on the outer edge, so the rounded
                // container keeps a clean border.
                (i > 0 ? "border-t border-gray-200 sm:border-t-0 " : "") +
                (i % 2 === 1 ? "sm:border-l sm:border-gray-200 " : "") +
                (i >= 2 ? "sm:border-t sm:border-gray-200 lg:border-t-0 " : "") +
                (i > 0 ? "lg:border-l lg:border-gray-200 " : "")
              }
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#FFF2EF] mb-5">
                <FontAwesomeIcon icon={icon} className="h-6 w-6 text-[#03162D]" />
              </span>
              <h3 className="font-bold text-[#03162D] mb-1.5">{title}</h3>
              <p className="text-sm text-[#495B7B] leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
