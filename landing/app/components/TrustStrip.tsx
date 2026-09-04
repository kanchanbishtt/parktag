import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faTruckFast, faMoneyBill1, faCalendarCheck, faArrowRotateLeft } from "@fortawesome/free-solid-svg-icons";

// The trust bar under the hero: four reassurances, each a claim plus the line
// that backs it, on one navy plate.
//
// Commerce terms, deliberately not product properties. The hero already carries
// "no app required / easy installation / no number sharing" directly under its
// sub-line, and a strip repeating those a screen later is the duplication this
// page has too much of already. These four answer the other question a stranger
// has — what happens after I pay — and every one is checkable in the checkout:
// delivery is free on all orders, COD exists with a Rs 50 surcharge, every tag
// ships with a year of Premium, and the refund policy is 7 days.
//
// "Made in India", which the reference strip carries, is deliberately absent.
// It is a manufacturing claim and nothing in this repo establishes it, so it
// would be the one line here that a buyer could not verify.
const ITEMS: [IconDefinition, string, string][] = [
  [faTruckFast, "Free delivery", "Anywhere in India"],
  [faMoneyBill1, "Cash on delivery", "Pay when it arrives"],
  [faCalendarCheck, "1 year included", "Premium on every tag"],
  [faArrowRotateLeft, "7-day replacement", "If damaged or faulty"],
];
export function TrustStrip() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6">
      {/* Two across on a phone rather than four. Four columns of icon + two
          lines at 375px leaves each about 80px wide, which breaks every label
          onto three lines. */}
      {/* The guideline's own --pt-gradient-header, rather than a metallic ramp
          invented here: 135deg from #010D1A through #03162D to #0B2244. The
          inset top highlight and the darker bottom edge are what make it read
          as a plate catching light rather than a flat rectangle, and both are
          white/black at low alpha so they work over any of the three stops. */}
      <div
        className="rounded-2xl px-6 py-7 sm:px-8 grid grid-cols-2 lg:grid-cols-4 gap-y-7 gap-x-6 shadow-xl shadow-black/20"
        style={{
          background: "linear-gradient(135deg, #010D1A 0%, #03162D 55%, #0B2244 100%)",
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.45), 0 18px 40px rgba(1,13,26,0.35)",
        }}
      >
        {ITEMS.map(([icon, title, sub], i) => (
          <div
            key={title}
            className={
              "flex items-center gap-4 " +
              // Dividers between columns, never before the first in a row.
              // lg:border-l on all but the first works at four across; at two
              // across the second column needs one too, hence the even/odd rule.
              (i % 2 === 1 ? "border-l border-white/12 pl-6 " : "") +
              (i > 0 ? "lg:border-l lg:border-white/12 lg:pl-6 " : "lg:border-l-0 lg:pl-0 ")
            }
          >
            <FontAwesomeIcon icon={icon} className="h-6 w-6 shrink-0 text-[#FEE600]" />
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-tight">{title}</p>
              <p className="text-white/55 text-[13px] leading-tight mt-1">{sub}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
