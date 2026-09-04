import Image from "next/image";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { SectionLabel } from "./SectionLabel";

// Head to head against "a typical QR tag", not against a named competitor.
//
// Every claim in the ParkTag column is checkable in this repo or on the
// listing: a year of Premium ships with each tag, messaging keeps working after
// it lapses (call-access.js blocks the masked CALL, not the message), no app is
// needed to scan, and CALL / WHATSAPP are printed on the artwork.
//
// Nothing in the other column names anyone or quotes a figure. Comparative
// claims about a named competitor have to be substantiable, and "45 days" or
// "needs an app" cannot be checked from here. Swap in the name and the specific
// numbers once there is a screenshot of their listing to stand behind.
const ROWS: [string, string, string][] = [
  ["App needed to scan", "Never", "Often required"],
  ["Call + WhatsApp on the tag", "Printed on it", "QR code only"],
  ["WhatsApp messaging", "Always free", "Limited or paid"],
  ["Premium included", "1 full year", "Short trial"],
  ["Your number shown", "Never", "Varies"],
  ["Material", "Weatherproof vinyl", "Paper or laminate"],
  ["In the pack", "2 tags · ₹499", "Usually one"],
];

export function WhyBetter() {
  return (
    <section className="bg-white py-20 sm:py-28">
      {/* Wider than the page's usual 5xl, and wider again on a large screen.
          Seven rows of three columns and a photograph that should not be
          cropped to a sliver compete for the same width; 5xl always starved one
          of them. 7xl at xl gives the table room to breathe and the hand its
          full height rather than a centre crop.
          This is the one section allowed past the page's container rule. It is
          a single plate rather than a column of text, so its edges never have
          to line up with the sections above and below it. */}
      <div className="max-w-6xl xl:max-w-[90rem] mx-auto px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[#03162D]">

          {/* Feathered into the plate rather than cropped against it, so there
              is no hard edge where the photograph stops and the card begins.
              This shot carries its own dark car interior, so the fade lands on
              navy meeting near-black rather than navy meeting a cut-out — which
              is why it works here and the artwork on white did not.
              Hidden below lg, where it would take width the table needs. */}
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] xl:w-[48%] lg:block">
            <Image
              src="/pack-card-in-hand.png"
              alt=""
              aria-hidden="true"
              fill
              sizes="(min-width: 1280px) 48vw, 46vw"
              className="object-cover object-right"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 30%, #000 62%)",
                WebkitMaskImage:
                  "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 30%, #000 62%)",
              }}
            />
          </div>

          <div className="relative px-6 py-12 sm:px-10 sm:py-14 xl:px-16 xl:py-14 lg:w-[58%] xl:w-[56%]">
            <p className="mb-6">
              <SectionLabel onDark>Why ParkTag is better</SectionLabel>
            </p>

            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-white/15">
                  <th className="pb-3 pr-4 text-sm font-bold text-white">Feature</th>
                  <th className="pb-3 px-3 text-sm font-bold text-[#FF2700] whitespace-nowrap">ParkTag</th>
                  <th className="pb-3 pl-3 text-sm font-bold text-white/50 whitespace-nowrap">Typical QR tag</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([feature, ours, theirs]) => (
                  <tr key={feature} className="border-b border-white/[0.07] last:border-0">
                    <td className="py-4 xl:py-5 pr-4 text-sm text-white/70">{feature}</td>
                    <td className="py-4 xl:py-5 px-3">
                      <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                        {/* The tick is the same green used for the WhatsApp
                            route, not a new one. */}
                        <FontAwesomeIcon icon={faCheck} className="h-3.5 w-3.5 shrink-0 text-[#3DBE45]" />
                        {ours}
                      </span>
                    </td>
                    <td className="py-4 xl:py-5 pl-3">
                      <span className="inline-flex items-center gap-2 text-sm text-white/45">
                        <FontAwesomeIcon icon={faXmark} className="h-3.5 w-3.5 shrink-0 text-white/30" />
                        {theirs}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* The row above that people skim past is the one worth saying out
                loud: a bare QR asks a stranger to guess what it does. */}
            <p className="mt-8 max-w-xl text-sm leading-relaxed text-white/55">
              Most tags print a QR and hope. Ours prints CALL and WHATSAPP beside
              it, so a passer-by knows what happens before they scan.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
