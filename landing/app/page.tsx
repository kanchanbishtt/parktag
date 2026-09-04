import Link from "next/link";
import { SiteHeader } from "./components/SiteHeader";
import { FaqAccordion } from "./components/FaqAccordion";
import { AnimateIn } from "./components/AnimateIn";
import { VehicleRotator } from "./components/VehicleRotator";
import { GetStartedButton } from "./components/GetStartedButton";
import { BuyOnAmazonButton } from "./components/BuyOnAmazonButton";
import { HazardStripe } from "./components/HazardStripe";
import { SectionLabel } from "./components/SectionLabel";
import { WhatIsParkTag } from "./components/WhatIsParkTag";
import { TrustStrip } from "./components/TrustStrip";
import { HowItWorksSteps } from "./components/HowItWorksSteps";
import { WhyBetter } from "./components/WhyBetter";

// Buy buttons point at /shop, which is the public storefront: packs, prices
// and a guest checkout, no login. It used to be an intent route that sent a
// signed-out visitor to /owner-login before a single price was visible
// (docs/SHOP_LOGIN_WALL.md); the storefront built to fix that lived at /get
// and nothing linked to it. It now lives at /shop, and /get redirects there.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";


/* ── Brand Sticker ── */
const QR_DOTS: [number, number][] = [
  [80,10],[90,10],[100,10],[115,10],[80,20],[100,20],[115,20],
  [85,30],[95,30],[110,30],[120,30],[80,40],[90,40],[105,40],
  [80,50],[100,50],[115,50],[125,50],[85,60],[95,60],[120,60],
  [80,80],[95,80],[110,80],[125,80],[85,90],[100,90],[115,90],
  [80,100],[90,100],[105,100],[120,100],[130,100],[80,110],[95,110],[125,110],
  [80,120],[90,120],[110,120],
  [132,80],[142,80],[157,80],[172,80],[182,80],[137,90],[152,90],[167,90],
  [132,100],[147,100],[162,100],[177,100],[132,110],[142,110],[157,110],[182,110],
  [137,120],[152,120],[167,120],[182,120],
  [80,142],[90,142],[115,142],[85,152],[100,152],[125,152],
  [80,162],[95,162],[110,162],[120,162],[85,172],[100,172],[125,172],
  [80,182],[95,182],[115,182],[130,182],
];

function BrandSticker() {
  return (
    <div style={{
      background: "#f0f3f7",
      border: "2.5px solid #03162D",
      borderRadius: "22px",
      padding: "20px 20px 18px",
      display: "flex",
      alignItems: "stretch",
      boxShadow: "0 20px 70px rgba(0,0,0,0.35), 0 4px 20px rgba(0,0,0,0.2)",
      width: "100%",
      maxWidth: "560px",
    }}>

      {/* LEFT PANEL */}
      <div style={{ flex: "1 1 0", paddingRight: "18px", display: "flex", flexDirection: "column", gap: "9px", minWidth: 0 }}>

        {/* Logo row */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <svg width="38" height="38" viewBox="0 0 100 100" fill="none" style={{ flexShrink: 0 }}>
            <rect width="100" height="100" rx="16" fill="#03162D"/>
            <rect x="14" y="14" width="16" height="72" rx="3" fill="white"/>
            <circle cx="46" cy="37" r="23" fill="white"/>
            <circle cx="46" cy="37" r="12" fill="#03162D"/>
            <path d="M40 37 L44 41 L53 28" stroke="#FF2700" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div style={{ width: "1.5px", height: "28px", background: "#94a3b8", borderRadius: "1px", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: "17px", color: "#03162D", lineHeight: 1 }}>
              Park<span style={{ color: "#FF2700" }}>Tag</span>
            </div>
            <div style={{ fontSize: "7.5px", fontWeight: 700, letterSpacing: "0.2em", color: "#64748b", marginTop: "3px" }}>
              SCAN TO CONNECT
            </div>
          </div>
        </div>

        {/* Green accent bar */}
        <div style={{ width: "22px", height: "3px", background: "#FF2700", borderRadius: "2px" }} />

        {/* Heading */}
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#03162D", lineHeight: 1.2, marginTop: "2px" }}>
          Scan to connect
        </div>
        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 500, marginTop: "-2px" }}>
          Private vehicle contact
        </div>

        {/* Shield feature */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "4px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M12 2L4 6v6c0 5.25 3.4 10.2 8 12 4.6-1.8 8-6.75 8-12V6l-8-4z" fill="#FF2700" opacity="0.15"/>
            <path d="M12 2L4 6v6c0 5.25 3.4 10.2 8 12 4.6-1.8 8-6.75 8-12V6l-8-4z" stroke="#FF2700" strokeWidth="1.5" fill="none"/>
            <rect x="10.5" y="10.5" width="3" height="4" rx="0.5" fill="#FF2700"/>
            <circle cx="12" cy="9.5" r="1" fill="#FF2700"/>
          </svg>
          <span style={{ fontSize: "12px", color: "#03162D", fontWeight: 600 }}>Number stays private</span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Footer info strip */}
        <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "9px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#03162D" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M5 11l1.5-4.5h11L19 11"/>
            <rect x="2" y="11" width="20" height="7" rx="2"/>
            <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
          </svg>
          <div style={{ borderLeft: "1px solid #cbd5e1", paddingLeft: "8px" }}>
            <div style={{ fontSize: "8.5px", color: "#94a3b8", fontWeight: 500 }}>Smart vehicle contact tag</div>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#03162D", letterSpacing: "0.04em" }}>PT-ID &nbsp;000128</div>
          </div>
          <div style={{ borderLeft: "1px solid #cbd5e1", paddingLeft: "8px", fontSize: "8.5px", color: "#94a3b8", lineHeight: 1.5 }}>
            Private · Secure · Verified
          </div>
        </div>
      </div>

      {/* Vertical divider */}
      <div style={{ width: "1px", background: "#cbd5e1", flexShrink: 0, alignSelf: "stretch" }} />

      {/* RIGHT PANEL — QR */}
      <div style={{ paddingLeft: "18px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", flexShrink: 0 }}>

        {/* QR with green scan corners */}
        <div style={{ position: "relative", padding: "10px", background: "white", borderRadius: "12px", border: "1.5px solid #03162D" }}>
          {/* Corner brackets */}
          {[
            { top: 0, left: 0, d: "M1 10 L1 1 L10 1" },
            { top: 0, right: 0, d: "M10 1 L19 1 L19 10" },
            { bottom: 0, left: 0, d: "M1 10 L1 19 L10 19" },
            { bottom: 0, right: 0, d: "M19 10 L19 19 L10 19" },
          ].map(({ d, ...pos }, i) => (
            <svg key={i} width="20" height="20" viewBox="0 0 20 20" style={{ position: "absolute", ...pos }}>
              <path d={d} stroke="#FF2700" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            </svg>
          ))}

          <svg viewBox="0 0 200 200" width="130" height="130" style={{ display: "block" }}>
            <rect width="200" height="200" fill="white"/>
            {/* Finders */}
            <rect x="10" y="10" width="58" height="58" rx="6" fill="#03162D"/>
            <rect x="18" y="18" width="42" height="42" rx="4" fill="white"/>
            <rect x="26" y="26" width="26" height="26" rx="2" fill="#03162D"/>
            <rect x="132" y="10" width="58" height="58" rx="6" fill="#03162D"/>
            <rect x="140" y="18" width="42" height="42" rx="4" fill="white"/>
            <rect x="148" y="26" width="26" height="26" rx="2" fill="#03162D"/>
            <rect x="10" y="132" width="58" height="58" rx="6" fill="#03162D"/>
            <rect x="18" y="140" width="42" height="42" rx="4" fill="white"/>
            <rect x="26" y="148" width="26" height="26" rx="2" fill="#03162D"/>
            {/* Data dots */}
            {QR_DOTS.map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="7" height="7" rx="1.5" fill="#03162D"/>
            ))}
            {/* Center logo */}
            <rect x="88" y="88" width="24" height="24" rx="4" fill="white"/>
            <rect x="90" y="90" width="20" height="20" rx="3" fill="#03162D"/>
            <path d="M95 100 L98 103 L105 93" stroke="#FF2700" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* SCAN HERE pill */}
        <div style={{
          background: "#03162D",
          color: "white",
          fontWeight: 800,
          fontSize: "11px",
          letterSpacing: "0.14em",
          padding: "9px 26px",
          borderRadius: "24px",
          whiteSpace: "nowrap",
        }}>
          SCAN HERE
        </div>
      </div>

    </div>
  );
}

/* ── Page ── */
export default function Home() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1 pt-16">

        {/* ── HERO ── */}
        {/* pb-0 only once the grid is side by side. Stacked, the sticker is the
            last thing in the column and pb-0 dropped it flush onto the caution
            band, so the artwork and the stripe collided with no air between
            them. On desktop the image still runs to the section edge, which is
            deliberate. */}
        <section data-nav-dark className="relative bg-[#03162D] pt-8 pb-24 md:pb-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-10 items-center min-h-[520px]">

              <AnimateIn from="bottom" delay={0} className="py-12 md:py-16">
                {/* Four words for the two promises the product actually makes.
                    The line it replaces was thirteen words whose subject was
                    other people — "Make it easy for PEOPLE to notify you" — and
                    which described a capability rather than naming a benefit.
                    "Any issue" was doing no work at all. */}
                <h1 className="text-5xl sm:text-6xl font-extrabold text-white leading-[1.05] tracking-tight mb-6">
                  Be reachable.<br />Stay{" "}
                  <span className="text-[#FF2700]">private.</span>
                </h1>
                {/* One sentence. The old one ran to three lines and spent the
                    first of them on a claim ("never shared") that the headline
                    now makes, so it was arguing a point already won. */}
                <p className="text-white/70 text-lg leading-relaxed mb-9 max-w-sm">
                  One QR tag lets anyone reach you about your{" "}
                  <span className="whitespace-nowrap"><VehicleRotator /></span>,
                  without seeing your number.
                </p>

                {/* Three properties of the product, under the sentence that
                    describes it and above the button, so the objections are
                    answered before the price is asked for. All three are
                    checkable: the scanner needs no app (it opens a webpage),
                    the tag is peel-and-stick on glass, and the number is never
                    exposed in any tier — callEntitlement() blocks the call
                    rather than placing an unmasked one.
                    The delivery and COD facts that used to sit here have not
                    been lost; they are on the terms line under the pricing
                    cards, which is where somebody is actually deciding. */}
                <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-9 text-sm text-white/70">
                  {/* Easy installation is the one that goes on a narrow screen.
                      Three of these wrap to two lines on a phone and the third
                      lands under a dangling divider; of the three it is also the
                      weakest, since "no app" and "no number sharing" are the two
                      objections a stranger actually raises. */}
                  {([
                    ["No app required", "", <svg key="a" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18.5h2"/><path d="M3 3l18 18"/></svg>],
                    ["Easy installation", "hidden sm:inline-flex", <svg key="b" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h11l5 5v11a0 0 0 0 1 0 0H4z"/><path d="M15 4v5h5"/><path d="M8 13.5c2 1.5 5 1.5 7 0"/></svg>],
                    ["No number sharing", "", <svg key="c" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5c1.7 0 3.2.5 4.5 1.3"/><path d="M20.4 9.2c.6.9 1.1 1.9 1.1 2.8 0 0-3.5 6.5-9.5 6.5-1.2 0-2.3-.3-3.3-.7"/><circle cx="12" cy="12" r="2.6"/><path d="M3 3l18 18"/></svg>],
                  ] as [string, string, React.ReactNode][]).map(([label, hide, icon], i) => (
                    <li key={label} className={`items-center gap-x-4 ${hide || "inline-flex"}`}>
                      {i > 0 && <span aria-hidden="true" className="w-px h-4 bg-white/15" />}
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[#FEE600]">{icon}</span>
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
                {/* One button, and it names the price. "Get Started" pointed at
                    a login screen, which is the wrong first destination for
                    someone who has never heard of the product, and is why this
                    now goes to the shop. Naming ₹499 on the button also filters:
                    anyone who clicks has already accepted the price. */}
                <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
                  <GetStartedButton
                    href={`${APP_URL}/shop`}
                    // Brand guideline, components/actions/Button.jsx primary:
                    // background var(--accent) #FF2700, hover var(--accent-hover)
                    // #D92200, white text, var(--radius-button) which resolves
                    // to --radius-xl / 14px, and the accent shadow. The pill and
                    // the yellow this replaces were taken from a reference image
                    // and matched neither. tokens/colors.css is unambiguous:
                    // "Brand red — the single accent. Signal, never decoration."
                    className="inline-flex items-center gap-2 bg-[#FF2700] hover:bg-[#D92200] text-white font-bold px-8 py-4 rounded-[14px] text-base transition-all shadow-[0_4px_16px_rgba(255,39,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,39,0,0.45)]"
                  >
                    Buy now · ₹499
                    <span aria-hidden="true">→</span>
                  </GetStartedButton>
                  <a
                    href="#how-it-works"
                    className="text-white/80 hover:text-white font-semibold text-base transition-colors"
                  >
                    See how it works
                  </a>
                </div>


                {/* Scan lived here too until the floating pill arrived. Two
                    entry points to the same camera modal on one screen, one of
                    them for a visitor who is not the buyer, was a choice this
                    hero did not need to offer. The floating control is
                    permanent and reaches every page, so this one was the
                    redundant half. */}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-6">
                  <BuyOnAmazonButton className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-white underline underline-offset-4 decoration-white/25 hover:decoration-white transition-colors" />
                </div>
              </AnimateIn>

              <AnimateIn from="bottom" delay={150} className="flex items-end justify-center md:justify-end mt-4 md:mt-0 md:pt-10">
                <div className="relative w-full max-w-lg">
                  <div className="absolute inset-0 bg-[#FF2700]/10 blur-3xl rounded-full scale-90" />
                  {/* The sticker's actual print artwork, both faces, rather
                      than a render of it. rounded-3xl is dropped with it: the
                      file has real transparency and its own rounded corners, so
                      a CSS radius on top was clipping the artwork's corners
                      against a shape that is not the sticker's. */}
                  <img
                    src="/sticker-artwork.png"
                    alt="The ParkTag sticker, showing the scan instructions and Call and WhatsApp buttons on the left and the QR code on the right"
                    width={1014}
                    height={609}
                    className="relative w-full drop-shadow-2xl"
                  />
                </div>
              </AnimateIn>
            </div>
          </div>

          {/* Absolutely positioned on the hero's own bottom edge, then pushed
              down half its height, so exactly half the band sits inside the
              navy and half hangs into the white below. Absolute rather than in
              the flow so the hero's height does not change and nothing below it
              moves.
              inset-x-0 rather than a width, so it runs the full page rather
              than the hero's container. z-30 puts it above both sections and
              the white section below, but BELOW the trust plate at z-20. The
              band is the layer the plate is resting on, not something laid over
              the top of it: at z-30 it ran straight through the labels. */}
          <HazardStripe className="absolute inset-x-0 bottom-0 translate-y-1/2 z-10 shadow-[0_6px_16px_rgba(1,13,26,0.35)]" />

        </section>

        {/* The band runs through the middle of the strip, not above it.
            The pull is half the strip's own height, so its centre line lands on
            the band: top half over the navy hero, bottom half over the white
            below, band passing behind it and reappearing left and right of the
            plate, which is narrower than the viewport.
            Two values because the strip is two rows until lg and one row after,
            so "half its height" is a different number on each. */}
        <div className="bg-white">
          <div className="relative z-20 -mt-[76px] lg:-mt-[46px]">
            <TrustStrip />
          </div>
        </div>

        <WhatIsParkTag />

        {/* ── BEFORE / AFTER ── */}
        <section className="bg-gray-50 py-20 sm:py-28">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <AnimateIn>
              <p className="mb-4"><SectionLabel>The Problem</SectionLabel></p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-3 tracking-tight">
                Stop writing your number<br />on a piece of paper.
              </h2>
              <p className="text-[#495B7B] mb-14 text-[15px] max-w-xl">
                Every handwritten note on your dashboard is a privacy risk. Your number goes to every stranger who walks past, whether they needed to contact you or not.
              </p>
            </AnimateIn>

            <div className="grid md:grid-cols-2 gap-5">
              <AnimateIn from="left">
                <div className="rounded-2xl border border-[#FF2700]/20 bg-white overflow-hidden h-full flex flex-col">
                  <div className="relative overflow-hidden" style={{ aspectRatio: "4/3" }}>
                    <img
                      src="/old-way.jpg"
                      alt="Handwritten note with phone number on car dashboard"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    <div className="absolute bottom-3 left-4 text-white text-xs font-semibold tracking-wide">
                      Your number exposed to everyone
                    </div>
                  </div>
                  <div className="p-7 flex-1">
                    <div className="text-[11px] font-bold text-[#FF2700] tracking-[0.15em] uppercase mb-5">The old way</div>
                    <ul className="space-y-3 text-sm text-[#495B7B]">
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✕</span> Your number visible to every passerby</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✕</span> No control over who saved it</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✕</span> Calls at odd hours long after the incident</li>
                    </ul>
                  </div>
                </div>
              </AnimateIn>

              <AnimateIn from="right" delay={100}>
                <div className="rounded-2xl border border-[#FF2700]/20 bg-white overflow-hidden h-full flex flex-col">
                  {/* Product photo */}
                  <div className="relative overflow-hidden" style={{ aspectRatio: "4/3" }}>
                    <img
                      src="/tag-scan.jpg"
                      alt="ParkTag sticker on car windshield being scanned by phone"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    <div className="absolute bottom-3 left-4 text-white text-xs font-semibold tracking-wide">
                      Scan to connect, no app needed
                    </div>
                  </div>
                  {/* Benefits */}
                  <div className="p-7 flex-1">
                    <div className="text-[11px] font-bold text-[#FF2700] tracking-[0.15em] uppercase mb-5">With ParkTag</div>
                    <ul className="space-y-3 text-sm text-[#495B7B]">
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✓</span> Number never shared, not even to us</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✓</span> Know exactly when and why someone scanned</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#FF2700] font-bold flex-shrink-0 mt-0.5">✓</span> Chat anonymously, share ETA, resolve in seconds</li>
                    </ul>
                  </div>
                </div>
              </AnimateIn>
            </div>
          </div>
        </section>

        {/* ── WHY PARKTAG ── */}
        <section className="bg-gray-50 py-20 sm:py-28">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-14 lg:gap-20 items-center">

              <AnimateIn from="left">
                <p className="mb-4"><SectionLabel>Why ParkTag</SectionLabel></p>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-5 tracking-tight leading-tight">
                  Why ParkTag works<br />where others don&apos;t.
                </h2>
                <p className="text-[#495B7B] leading-relaxed mb-8 text-[15px]">
                  Most solutions need both parties on the same app. ParkTag doesn&apos;t. Whoever is trying to reach you just points their phone camera at your tag. That&apos;s it.
                </p>
                <a href={`${APP_URL}/shop`} className="inline-flex items-center bg-[#FF2700] hover:bg-[#D92200] text-white font-bold px-6 py-3 rounded-xl transition-colors text-sm">
                  Order your tag →
                </a>
              </AnimateIn>

              <AnimateIn from="right" delay={120}>
                <div className="space-y-7">
                  {[
                    { title: "No app needed to scan", body: "Anyone with a phone can scan and reach you. No download, no sign-up, no friction whatsoever." },
                    { title: "Your number stays private", body: "All contact runs through our platform. The scanner never sees your phone number, name, or address." },
                    { title: "Done in under a minute", body: "Get notified, share your ETA, move your car. No notes on windscreens, no arguments in the parking lot." },
                  ].map(({ title, body }) => (
                    <div key={title} className="flex gap-4">
                      <div className="w-[3px] flex-shrink-0 bg-[#FF2700] rounded-full" style={{ minHeight: "24px" }} />
                      <div>
                        <h3 className="font-bold text-[#03162D] mb-1.5">{title}</h3>
                        <p className="text-[#495B7B] text-sm leading-relaxed">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </AnimateIn>

            </div>
          </div>
        </section>

        <WhyBetter />

        {/* ── HOW IT WORKS ── */}
        {/*
          Rebuilt from a two-column layout that said everything twice. The left
          column carried the heading, a paragraph and four bullets; the right
          carried four numbered steps. The bullets were a summary of the steps
          sitting next to the steps — "No app needed to scan" beside "No app. No
          sign-up.", "Owner's number never exposed" beside "The scanner never
          sees your number" — so the eye had to choose a column, then zigzag.

          One column now, read top to bottom. The bullets are gone rather than
          relocated: everything they said is in a step already.

          The OWNER / SCANNER tags are gone too. They were a second taxonomy the
          reader had to hold while also following 1-2-3-4, to answer a question
          nobody asks. Whose turn it is is obvious from the sentence.

          Step four inverts to a white card. Previously it looked identical to
          steps one through three, so the sequence just stopped rather than
          arriving anywhere; it is the payoff and now reads as one.
        */}
        <section id="how-it-works" data-nav-dark className="bg-[#03162D] py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">

            <div className="text-center mb-14">
              <p className="mb-5"><SectionLabel onDark>How It Works</SectionLabel></p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight leading-tight">
                Someone reaches you.<br />Your number stays hidden.
              </h2>
              <p className="text-white/55 leading-relaxed max-w-lg mx-auto">
                No app for them. No number sharing for you. Here is how it works.
              </p>
            </div>

            <HowItWorksSteps />
          </div>
        </section>

        <HazardStripe />

        {/* ── PRICING ── */}
        <section id="pricing" className="bg-white py-20 sm:py-28">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">

            <AnimateIn>
              <p className="mb-3"><SectionLabel>Pricing</SectionLabel></p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-2 tracking-tight">Buy your ParkTag</h2>
              <p className="text-[#495B7B] mb-12">Every premium tag includes a 1-year subscription. Shipped across India.</p>
            </AnimateIn>

            <div className="grid sm:grid-cols-2 gap-5 mb-5">

              {/* Solo */}
              <AnimateIn delay={60}>
                {/* Hover lift. `transition` (not `transition-colors`) so the
                    shadow and transform animate too, and the movement is behind
                    motion-safe: a lift is decorative, so it is dropped for
                    anyone who asked the OS for reduced motion — they still get
                    the border/shadow feedback. The lift lives on the CARD, not
                    on the AnimateIn wrapper, whose inline transform drives the
                    scroll-in animation and would otherwise be overwritten. */}
                <div className="border border-gray-200 rounded-2xl p-8 flex flex-col h-full hover:border-gray-300 hover:shadow-xl motion-safe:hover:-translate-y-1 transition duration-300 ease-out">
                  <div className="text-xs font-bold tracking-widest uppercase text-[#495B7B] mb-5">Solo Tag</div>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-[#03162D] tracking-tight leading-none">₹299</span>
                    <span className="text-sm text-[#495B7B] mb-1">1 year included</span>
                  </div>
                  <div className="text-xs text-[#495B7B] mb-8">1 vehicle · ₹299 per tag</div>

                  <ul className="space-y-3 mb-10 flex-1">
                    {[
                      "1 waterproof QR tag, delivered to your door",
                      "1-year subscription included",
                      "Instant alert every time your tag is scanned",
                      "Anonymous call + WhatsApp routing",
                      "Owner dashboard: toggle tag on / off",
                    ].map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-[#495B7B]">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                          <circle cx="8" cy="8" r="7" fill="#FF2700" opacity="0.12"/>
                          <path d="M5 8l2 2 4-4" stroke="#FF2700" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <a href={`${APP_URL}/shop`} className="block text-center border-2 border-[#FF2700] text-[#FF2700] font-bold py-3 rounded-xl hover:bg-[#FF2700] hover:text-white transition-colors text-sm">
                    Get Solo Tag
                  </a>
                </div>
              </AnimateIn>

              {/* Duo — recommended */}
              <AnimateIn delay={120}>
                {/* Same lift as Solo. A heavier shadow because this card is
                    dark on white, where a lighter one barely reads. */}
                <div className="bg-[#03162D] rounded-2xl p-8 flex flex-col h-full relative overflow-hidden hover:shadow-2xl motion-safe:hover:-translate-y-1 transition duration-300 ease-out">
                  {/* Most Popular badge */}
                  <div className="absolute top-5 right-5 bg-[#FF2700] text-white text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full">
                    Best Value
                  </div>

                  <div className="text-xs font-bold tracking-widest uppercase text-white/40 mb-5">Duo Pack</div>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-white tracking-tight leading-none">₹499</span>
                    <span className="text-sm text-white/40 mb-1">1 year included</span>
                  </div>
                  <div className="text-xs text-white/40 mb-8">1 car · front &amp; back · ₹249.50 per tag · saves ₹99</div>

                  <ul className="space-y-3 mb-10 flex-1">
                    {[
                      "2 waterproof QR tags, shipped together",
                      "Everything in Solo, front and back of your car",
                      "₹99 cheaper than buying two Solo tags",
                      "1-year subscription included",
                      "Priority support",
                    ].map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-white/60">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                          <circle cx="8" cy="8" r="7" fill="#FF2700" opacity="0.2"/>
                          <path d="M5 8l2 2 4-4" stroke="#FF2700" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <a href={`${APP_URL}/shop`} className="block text-center bg-[#FF2700] hover:bg-[var(--red-hover)] text-white font-bold py-3 rounded-xl transition-colors text-sm">
                    Get Duo Pack
                  </a>
                  {/* Duo Pack only — it is the same pack of 2 the Amazon
                      listing sells. Deliberately no longer claiming the two are
                      "at the same price": Amazon's shown price moves with their
                      own discounting and has been observed below the ₹499 here,
                      so a comment asserting parity was a claim nobody was
                      checking. Same product, whichever price each storefront
                      happens to be showing. */}
                  {/* Light-card classes on a navy card: border-gray-300 and
                      #495B7B text put the only alternative buy route at roughly
                      2:1 against #03162D, and its hover made it darker still.
                      White on this navy is 18.2:1 and the border at 50% alpha is
                      visible without competing with the primary above it. */}
                  <BuyOnAmazonButton className="mt-3 w-full inline-flex items-center justify-center gap-2 text-center border border-white/50 text-white font-semibold py-3 rounded-xl text-sm transition-all duration-200 hover:bg-white/[0.08] hover:border-white hover:shadow-lg hover:shadow-black/30" />
                </div>
              </AnimateIn>

            </div>

            {/* The terms a stranger weighing up ₹499 wants before committing,
                beside the buttons rather than in a footer link and an FAQ they
                may never open. Cold ad traffic has none of the community trust
                that carried the launch. */}
            {/* mb matters as much as mt here: this sits between the pricing
                cards and the Fleet block, and with only a top margin the Fleet
                card butted straight into it. It belongs to the cards above, so
                the gap below it is the larger of the two. */}
            <p className="mt-8 mb-14 text-center text-sm text-[#495B7B]">
              Free delivery across India · Cash on Delivery available (+₹50) ·{" "}
              <Link href="/refund" className="underline underline-offset-4 decoration-[#495B7B]/40 hover:text-[#03162D] hover:decoration-[#03162D] transition-colors">
                7-day replacement if damaged or faulty
              </Link>
            </p>

            {/* Fleet */}
            <AnimateIn delay={180}>
              <div className="rounded-2xl bg-gray-50 border border-gray-100 px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#03162D" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5 opacity-50">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <div>
                    <span className="font-bold text-[#03162D]">Fleet: 5 or more vehicles</span>
                    <p className="text-sm text-[#495B7B] mt-1">Bulk pricing, fleet dashboard, batch tag issuance, dedicated account support.</p>
                  </div>
                </div>
                {/* Was a mailto:, which on a machine with no mail client
                    configured silently does nothing. Routed to the contact page
                    instead, via next/link so it prefetches and navigates
                    client-side like every other internal link on the site. */}
                <Link href="/contact" className="flex-shrink-0 text-sm font-bold text-[#FF2700] border-2 border-[#FF2700] px-6 py-2.5 rounded-xl hover:bg-[#FF2700] hover:text-white transition-colors">
                  Talk to us
                </Link>
              </div>
            </AnimateIn>

          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="bg-gray-50 py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <p className="text-center mb-4"><SectionLabel>FAQ</SectionLabel></p>
            <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-[#03162D] mb-12 tracking-tight leading-snug">
              If your question isn&apos;t answered here,{" "}
              please <Link href="/contact" className="text-[#FF2700] hover:underline">contact us</Link>{" "}
              using the email form.
            </h2>
            <FaqAccordion />
          </div>
        </section>

        <HazardStripe />

        {/* ── CTA ── */}
        <section data-nav-dark className="bg-[#03162D] py-20 sm:py-28">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <AnimateIn>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight">
                Never miss a call about<br />your parked vehicle again.
              </h2>
              <p className="text-white/50 mb-8">Join vehicle owners across India who park with confidence.</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <a href={`${APP_URL}/shop`} className="inline-block bg-[#FF2700] hover:bg-[var(--red-hover)] text-white font-bold px-8 py-4 rounded-xl transition-colors text-base">
                  Get Your ParkTag →
                </a>
                <BuyOnAmazonButton className="inline-flex items-center gap-1.5 text-base text-white/60 hover:text-white underline underline-offset-4 decoration-white/25 hover:decoration-white transition-colors" />
              </div>
              <p className="text-white/25 text-sm mt-4">Starting at ₹299 · Ships across India · 1-year subscription included</p>
            </AnimateIn>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-[#010D1A] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-4 gap-8 mb-10">
            <div className="sm:col-span-2">
              <div className="mb-3">
                <img src="/dark-logo.png" alt="ParkTag" style={{ height: "42px", width: "auto" }} />
              </div>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs">Smart vehicle connection system built for modern India. Simple, secure, accessible.</p>
              <a
                href="mailto:support@parktag.me"
                className="mt-4 inline-flex items-center rounded-full border border-white/35 px-4 py-2 text-sm text-white transition-colors hover:border-white hover:bg-white/10"
              >
                support@parktag.me
              </a>
            </div>

            <div>
              <div className="text-white/25 text-xs font-bold uppercase tracking-widest mb-4">Product</div>
              <ul className="space-y-3">
                {[["How it Works", "#how-it-works"], ["Features", "#features"], ["Pricing", "#pricing"], ["FAQ", "#faq"], ["About Us", "/about"]].map(([l, h]) => (
                  <li key={l}>
                    {h.startsWith("/") ? (
                      <Link href={h} className="text-white/50 hover:text-white text-sm transition-colors">{l}</Link>
                    ) : (
                      <a href={h} className="text-white/50 hover:text-white text-sm transition-colors">{l}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-white/25 text-xs font-bold uppercase tracking-widest mb-4">Legal</div>
              <ul className="space-y-3">
                {[["Terms of Service", "/terms"], ["Privacy Policy", "/privacy"], ["Refund Policy", "/refund"]].map(([l, h]) => (
                  <li key={l}><Link href={h} className="text-white/50 hover:text-white text-sm transition-colors">{l}</Link></li>
                ))}
              </ul>
            </div>
          </div>

          <div className="border-t border-white/8 pt-8 flex flex-col sm:flex-row justify-between items-center gap-3">
            <p className="text-white/25 text-sm">© 2025 ParkTag. Made in India.</p>
            <p className="text-white/25 text-sm">EditTree Technologies Pvt. Ltd.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
