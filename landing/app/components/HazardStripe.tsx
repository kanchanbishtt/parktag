// The brand's caution-tape band.
//
// The export was a 2103px-wide SVG holding 45 fixed stripes. Dropping that in
// and stretching it to the viewport would have changed the stripe angle with
// the window — shallower on a wide monitor, steeper on a phone. The angle is
// the recognisable part of the pattern, so it is the one thing that must not
// move. This repeats a single period at its native size instead, so the stripes
// are identical at every width and only their count changes.
//
// Geometry is verbatim from the export: pitch 47.0225, stripes spanning y 1.98
// to 12.59 in a 15-tall band, normalised so the bottom edge starts at x=0. The
// tile is self-contained — no stripe crosses its boundary — which is why a
// plain repeat is seamless.
const TILE_W = 47.0225;
const BAND_H = 15;
const STRIPE = "M23.7074 12.5886L0 12.5886L10.0996 1.98235L33.807 1.98236L23.7074 12.5886Z";

const NAVY = "#03162D";
const YELLOW = "#FEE600";

// A CSS background rather than an inline <svg><pattern>. The pattern version
// needs an id to reference, and this component is meant to be used several
// times per page: every instance sharing a palette would emit the same id, and
// duplicate ids are invalid markup that SVG resolves to whichever came first.
// Deriving the id from the colours avoids the wrong-palette bug but not the
// duplication. A background-image has no id to collide, and background-repeat-x
// does the tiling the <pattern> element was there to do.
//
// Not base64 — percent-encoding keeps the markup legible in devtools and is
// smaller for text like this.
function tile(background: string, stripe: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${TILE_W}' height='${BAND_H}'>` +
    `<rect width='${TILE_W}' height='${BAND_H}' fill='${background}'/>` +
    `<path d='${STRIPE}' fill='${stripe}'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function HazardStripe({
  height = BAND_H,
  background = NAVY,
  stripe = YELLOW,
  className = "",
}: {
  height?: number;
  background?: string;
  stripe?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`w-full ${className}`}
      style={{
        height,
        // Fills whatever the tile does not cover. The tile is a fixed 15 tall
        // and must not stretch, so a caller passing a taller band would
        // otherwise get transparent gutters above and below the stripes; this
        // makes that case render as a thicker band instead of a broken one.
        backgroundColor: background,
        backgroundImage: tile(background, stripe),
        backgroundRepeat: "repeat-x",
        // Pinned to the tile's true size. Without this the browser scales the
        // image to the element and the angle drifts again, which is the whole
        // thing this component exists to prevent.
        backgroundSize: `${TILE_W}px ${BAND_H}px`,
        backgroundPosition: "left center",
      }}
    />
  );
}
