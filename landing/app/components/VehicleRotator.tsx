const VEHICLES = ["Bike", "Car", "Truck", "Scooter", "EV", "Bicycle"];
const SLOT_S = 2.4;
const CYCLE_S = SLOT_S * VEHICLES.length;

// CSS-only rotation (.pt-rotator in globals.css): no timers, no hydration, and
// the words share one grid cell so the box is always as wide as the longest
// one and the sentence around it never reflows. Only the first word is exposed
// to assistive tech, matching what the static markup reads as.
export function VehicleRotator() {
  return (
    <span
      className="pt-rotator"
      // White, brighter than the white/70 of the sentence around it. The
      // word already draws the eye by moving; colouring it as well was two
      // signals for one job, and it put a third colour in a headline block
      // that already spends red on "private".
      style={{ color: "#FFFFFF" }}
    >
      {VEHICLES.map((word, i) => (
        <span
          key={word}
          aria-hidden={i > 0 || undefined}
          // Word i must be "at the start of its slot" at t = i * SLOT_S, so a
          // negative delay shifts it into the cycle rather than waiting.
          style={{ animationDelay: i === 0 ? "0s" : `${i * SLOT_S - CYCLE_S}s` }}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
