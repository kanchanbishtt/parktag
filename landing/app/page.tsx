import Link from "next/link";
import { SiteHeader } from "./components/SiteHeader";
import { FaqAccordion } from "./components/FaqAccordion";
import { AnimateIn } from "./components/AnimateIn";
import { Marquee } from "./components/Marquee";
import { VehicleRotator } from "./components/VehicleRotator";

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
      border: "2.5px solid #001935",
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
            <rect width="100" height="100" rx="16" fill="#001935"/>
            <rect x="14" y="14" width="16" height="72" rx="3" fill="white"/>
            <circle cx="46" cy="37" r="23" fill="white"/>
            <circle cx="46" cy="37" r="12" fill="#001935"/>
            <path d="M40 37 L44 41 L53 28" stroke="#1A9D20" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div style={{ width: "1.5px", height: "28px", background: "#94a3b8", borderRadius: "1px", flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: "17px", color: "#001935", lineHeight: 1 }}>
              Park<span style={{ color: "#1A9D20" }}>Tag</span>
            </div>
            <div style={{ fontSize: "7.5px", fontWeight: 700, letterSpacing: "0.2em", color: "#64748b", marginTop: "3px" }}>
              SCAN TO CONNECT
            </div>
          </div>
        </div>

        {/* Green accent bar */}
        <div style={{ width: "22px", height: "3px", background: "#1A9D20", borderRadius: "2px" }} />

        {/* Heading */}
        <div style={{ fontSize: "20px", fontWeight: 800, color: "#001935", lineHeight: 1.2, marginTop: "2px" }}>
          Scan to connect
        </div>
        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 500, marginTop: "-2px" }}>
          Private vehicle contact
        </div>

        {/* Shield feature */}
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "4px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <path d="M12 2L4 6v6c0 5.25 3.4 10.2 8 12 4.6-1.8 8-6.75 8-12V6l-8-4z" fill="#1A9D20" opacity="0.15"/>
            <path d="M12 2L4 6v6c0 5.25 3.4 10.2 8 12 4.6-1.8 8-6.75 8-12V6l-8-4z" stroke="#1A9D20" strokeWidth="1.5" fill="none"/>
            <rect x="10.5" y="10.5" width="3" height="4" rx="0.5" fill="#1A9D20"/>
            <circle cx="12" cy="9.5" r="1" fill="#1A9D20"/>
          </svg>
          <span style={{ fontSize: "12px", color: "#001935", fontWeight: 600 }}>Number stays private</span>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Footer info strip */}
        <div style={{ borderTop: "1px solid #cbd5e1", paddingTop: "9px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#001935" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M5 11l1.5-4.5h11L19 11"/>
            <rect x="2" y="11" width="20" height="7" rx="2"/>
            <circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>
          </svg>
          <div style={{ borderLeft: "1px solid #cbd5e1", paddingLeft: "8px" }}>
            <div style={{ fontSize: "8.5px", color: "#94a3b8", fontWeight: 500 }}>Smart vehicle contact tag</div>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "#001935", letterSpacing: "0.04em" }}>PT-ID &nbsp;000128</div>
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
        <div style={{ position: "relative", padding: "10px", background: "white", borderRadius: "12px", border: "1.5px solid #001935" }}>
          {/* Corner brackets */}
          {[
            { top: 0, left: 0, d: "M1 10 L1 1 L10 1" },
            { top: 0, right: 0, d: "M10 1 L19 1 L19 10" },
            { bottom: 0, left: 0, d: "M1 10 L1 19 L10 19" },
            { bottom: 0, right: 0, d: "M19 10 L19 19 L10 19" },
          ].map(({ d, ...pos }, i) => (
            <svg key={i} width="20" height="20" viewBox="0 0 20 20" style={{ position: "absolute", ...pos }}>
              <path d={d} stroke="#1A9D20" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            </svg>
          ))}

          <svg viewBox="0 0 200 200" width="130" height="130" style={{ display: "block" }}>
            <rect width="200" height="200" fill="white"/>
            {/* Finders */}
            <rect x="10" y="10" width="58" height="58" rx="6" fill="#001935"/>
            <rect x="18" y="18" width="42" height="42" rx="4" fill="white"/>
            <rect x="26" y="26" width="26" height="26" rx="2" fill="#001935"/>
            <rect x="132" y="10" width="58" height="58" rx="6" fill="#001935"/>
            <rect x="140" y="18" width="42" height="42" rx="4" fill="white"/>
            <rect x="148" y="26" width="26" height="26" rx="2" fill="#001935"/>
            <rect x="10" y="132" width="58" height="58" rx="6" fill="#001935"/>
            <rect x="18" y="140" width="42" height="42" rx="4" fill="white"/>
            <rect x="26" y="148" width="26" height="26" rx="2" fill="#001935"/>
            {/* Data dots */}
            {QR_DOTS.map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="7" height="7" rx="1.5" fill="#001935"/>
            ))}
            {/* Center logo */}
            <rect x="88" y="88" width="24" height="24" rx="4" fill="white"/>
            <rect x="90" y="90" width="20" height="20" rx="3" fill="#001935"/>
            <path d="M95 100 L98 103 L105 93" stroke="#1A9D20" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>

        {/* SCAN HERE pill */}
        <div style={{
          background: "#001935",
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
        <section data-nav-dark className="bg-[#001935] pt-8 pb-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-10 items-center min-h-[520px]">

              <div className="py-12 md:py-16">
                <h1 className="text-[2.6rem] sm:text-5xl font-extrabold text-white leading-[1.12] tracking-tight mb-6 max-w-[420px]">
                  Make it easy for people to notify you about any issue involving your{" "}
                  <span className="whitespace-nowrap"><VehicleRotator /></span>
                </h1>
                <p className="text-white/60 text-lg leading-relaxed mb-8 max-w-sm">
                  Your phone number is never shared. Anyone with a smartphone can reach you about your parked vehicle, just by scanning a QR tag.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a href={`${APP_URL}/register-owner`} className="bg-[#1A9D20] hover:bg-[#158018] text-white font-bold px-7 py-3.5 rounded-xl text-base transition-colors">
                    Get Started
                  </a>
                  <a href="#how-it-works" className="border border-white/20 hover:border-white/40 text-white font-semibold px-7 py-3.5 rounded-xl text-base transition-colors">
                    How it works
                  </a>
                </div>
              </div>

              <div className="flex items-end justify-center md:justify-end pt-10">
                <div className="relative w-full max-w-lg">
                  <div className="absolute inset-0 bg-[#1A9D20]/10 blur-3xl rounded-full scale-90" />
                  <img
                    src="/brand-sticker.png"
                    alt="ParkTag brand sticker"
                    className="relative w-full drop-shadow-2xl rounded-3xl"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SVG wave divider */}
          <svg viewBox="0 0 1440 72" preserveAspectRatio="none" className="block w-full" style={{ height: "72px", marginBottom: "-2px" }}>
            <path d="M0,80 C360,8 1080,8 1440,80 L1440,80 L0,80 Z" fill="white" />
          </svg>
        </section>

        <Marquee />

        {/* ── SPECIAL FEATURES ── */}
        <section id="features" className="bg-white py-14">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">

            {/* Section label */}
            <p className="text-center text-[11px] font-medium tracking-[0.28em] text-[#495B7B] uppercase mb-10">
              Some Special Features
            </p>

            <div className="grid grid-cols-4 sm:grid-cols-8 gap-y-8 gap-x-4">
              {([
                ["Instant Scan Alert", <svg key="bell" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>],
                ["Anonymous Chat", <svg key="chat" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>],
                ["No App to Scan", <svg key="qr" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="7" width="4" height="4"/><rect x="7" y="13" width="4" height="4"/></svg>],
                ["Number Private", <svg key="lock" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>],
                ["Any Vehicle Type", <svg key="car" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M5 12h14"/></svg>],
                ["Share Your ETA", <svg key="loc" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>],
                ["Waterproof Tag", <svg key="drop" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>],
                ["One-Time Payment", <svg key="pay" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>],
              ] as [string, React.ReactNode][]).map(([label, icon]) => (
                <div key={label} className="flex flex-col items-center gap-2.5 text-center group">
                  <div className="text-[#495B7B] group-hover:text-[#1A9D20] transition-colors duration-200">{icon}</div>
                  <span className="text-[11px] text-[#495B7B] font-medium leading-tight">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── BEFORE / AFTER ── */}
        <section className="bg-gray-50 py-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <AnimateIn>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#001935] mb-3 tracking-tight">
                Stop writing your number<br />on a piece of paper.
              </h2>
              <p className="text-[#495B7B] mb-14 text-[15px] max-w-xl">
                Every handwritten note on your dashboard is a privacy risk. Your number goes to every stranger who walks past, whether they needed to contact you or not.
              </p>
            </AnimateIn>

            <div className="grid md:grid-cols-2 gap-5">
              <AnimateIn from="left">
                <div className="rounded-2xl border border-red-100 bg-white overflow-hidden h-full flex flex-col">
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
                    <div className="text-[11px] font-bold text-red-400 tracking-[0.15em] uppercase mb-5">The old way</div>
                    <ul className="space-y-3 text-sm text-[#495B7B]">
                      <li className="flex gap-2.5 items-start"><span className="text-red-400 font-bold flex-shrink-0 mt-0.5">✕</span> Your number visible to every passerby</li>
                      <li className="flex gap-2.5 items-start"><span className="text-red-400 font-bold flex-shrink-0 mt-0.5">✕</span> No control over who saved it</li>
                      <li className="flex gap-2.5 items-start"><span className="text-red-400 font-bold flex-shrink-0 mt-0.5">✕</span> Calls at odd hours long after the incident</li>
                    </ul>
                  </div>
                </div>
              </AnimateIn>

              <AnimateIn from="right" delay={100}>
                <div className="rounded-2xl border border-[#1A9D20]/20 bg-white overflow-hidden h-full flex flex-col">
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
                    <div className="text-[11px] font-bold text-[#1A9D20] tracking-[0.15em] uppercase mb-5">With ParkTag</div>
                    <ul className="space-y-3 text-sm text-[#495B7B]">
                      <li className="flex gap-2.5 items-start"><span className="text-[#1A9D20] font-bold flex-shrink-0 mt-0.5">✓</span> Number never shared, not even to us</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#1A9D20] font-bold flex-shrink-0 mt-0.5">✓</span> Know exactly when and why someone scanned</li>
                      <li className="flex gap-2.5 items-start"><span className="text-[#1A9D20] font-bold flex-shrink-0 mt-0.5">✓</span> Chat anonymously, share ETA, resolve in seconds</li>
                    </ul>
                  </div>
                </div>
              </AnimateIn>
            </div>
          </div>
        </section>

        {/* ── WHY PARKTAG ── */}
        <section className="bg-gray-50 py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-14 lg:gap-20 items-center">

              <AnimateIn from="left">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-[#001935] mb-5 tracking-tight leading-tight">
                  Why ParkTag works<br />where others don&apos;t.
                </h2>
                <p className="text-[#495B7B] leading-relaxed mb-8 text-[15px]">
                  Most solutions need both parties on the same app. ParkTag doesn&apos;t. Whoever is trying to reach you just points their phone camera at your tag. That&apos;s it.
                </p>
                <a href={`${APP_URL}/register-owner`} className="inline-flex items-center bg-[#001935] text-white font-bold px-6 py-3 rounded-xl hover:bg-[#03162D] transition-colors text-sm">
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
                      <div className="w-[3px] flex-shrink-0 bg-[#1A9D20] rounded-full" style={{ minHeight: "24px" }} />
                      <div>
                        <h3 className="font-bold text-[#001935] mb-1.5">{title}</h3>
                        <p className="text-[#495B7B] text-sm leading-relaxed">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </AnimateIn>

            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" data-nav-dark className="bg-[#001935] py-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="grid md:grid-cols-2 gap-14 lg:gap-24 items-start">

              <AnimateIn from="left">
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-6 tracking-tight leading-tight">
                  A stranger reaches you.<br />Your number stays hidden.
                </h2>
                <p className="text-white/55 leading-relaxed text-[15px] mb-8">
                  ParkTag lets anyone contact a parked vehicle owner instantly, through a masked call or WhatsApp — without ever seeing the owner's private phone number.
                </p>
                <div className="flex flex-col gap-3">
                  {["No app needed to scan", "Owner's number never exposed", "Works on any phone camera", "Owner controls tag on / off"].map((point) => (
                    <div key={point} className="flex items-center gap-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#1A9D20] flex-shrink-0" />
                      <span className="text-white/50 text-sm">{point}</span>
                    </div>
                  ))}
                </div>
              </AnimateIn>

              <AnimateIn from="right" delay={120}>
                <div className="space-y-0">
                  {[
                    {
                      actor: "Owner",
                      step: "Register your vehicle",
                      body: "Visit parktag.me, create an account, and link your unique QR tag to your vehicle: plate number, contact preference, done.",
                    },
                    {
                      actor: "Owner",
                      step: "Stick the tag on",
                      body: "Peel and stick the waterproof QR sticker on your windshield or bumper. Takes 30 seconds. Toggle it off any time from your dashboard.",
                    },
                    {
                      actor: "Scanner",
                      step: "Someone scans the QR",
                      body: "No app. No sign-up. They open their phone camera, scan the tag, and choose to call or send a WhatsApp message.",
                    },
                    {
                      actor: "Owner",
                      step: "You get connected, privately",
                      body: "The call or message is routed through ParkTag. The scanner never sees your number. You see their intent, reply, resolve.",
                    },
                  ].map(({ actor, step, body }, i) => (
                    <div key={step} className="flex gap-5 items-start group">
                      <div className="flex flex-col items-center flex-shrink-0" style={{ width: "32px" }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: actor === "Scanner" ? "rgba(26,157,32,0.15)" : "rgba(255,255,255,0.08)", color: actor === "Scanner" ? "#1A9D20" : "rgba(255,255,255,0.4)" }}>
                          {i + 1}
                        </div>
                        {i < 3 && <div className="w-px flex-1 bg-white/8 mt-1 mb-1" style={{ minHeight: "24px" }} />}
                      </div>
                      <div className="pb-7">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-bold tracking-widest uppercase"
                            style={{ color: actor === "Scanner" ? "#1A9D20" : "rgba(255,255,255,0.25)" }}>
                            {actor}
                          </span>
                        </div>
                        <h3 className="text-white font-bold text-sm mb-1">{step}</h3>
                        <p className="text-white/45 text-sm leading-relaxed">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </AnimateIn>

            </div>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="bg-white py-20">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">

            <AnimateIn>
              <p className="text-xs font-bold text-[#1A9D20] tracking-widest uppercase mb-3">Pricing</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-[#001935] mb-2 tracking-tight">One tag. One payment.</h2>
              <p className="text-[#495B7B] mb-12">No subscription. No renewal. Pay once, it works forever.</p>
            </AnimateIn>

            <div className="grid sm:grid-cols-2 gap-5 mb-5">

              {/* Solo */}
              <AnimateIn delay={60}>
                <div className="border border-gray-200 rounded-2xl p-8 flex flex-col h-full hover:border-gray-300 transition-colors">
                  <div className="text-xs font-bold tracking-widest uppercase text-[#495B7B] mb-5">Solo Tag</div>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-[#001935] tracking-tight leading-none">₹199</span>
                    <span className="text-sm text-[#495B7B] mb-1">one-time</span>
                  </div>
                  <div className="text-xs text-[#495B7B] mb-8">1 vehicle · ₹199 per tag</div>

                  <ul className="space-y-3 mb-10 flex-1">
                    {[
                      "1 waterproof QR tag, delivered to your door",
                      "Instant alert every time your tag is scanned",
                      "Anonymous call + WhatsApp routing",
                      "Owner dashboard: toggle tag on / off",
                    ].map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-[#495B7B]">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                          <circle cx="8" cy="8" r="7" fill="#1A9D20" opacity="0.12"/>
                          <path d="M5 8l2 2 4-4" stroke="#1A9D20" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <a href={`${APP_URL}/register-owner`} className="block text-center border-2 border-[#001935] text-[#001935] font-bold py-3 rounded-xl hover:bg-[#001935] hover:text-white transition-colors text-sm">
                    Get Solo Tag
                  </a>
                </div>
              </AnimateIn>

              {/* Duo — recommended */}
              <AnimateIn delay={120}>
                <div className="bg-[#001935] rounded-2xl p-8 flex flex-col h-full relative overflow-hidden">
                  {/* Most Popular badge */}
                  <div className="absolute top-5 right-5 bg-[#1A9D20] text-white text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full">
                    Best Value
                  </div>

                  <div className="text-xs font-bold tracking-widest uppercase text-white/40 mb-5">Duo Pack</div>
                  <div className="flex items-end gap-2 mb-1">
                    <span className="text-5xl font-extrabold text-white tracking-tight leading-none">₹349</span>
                    <span className="text-sm text-white/40 mb-1">one-time</span>
                  </div>
                  <div className="text-xs text-white/40 mb-8">2 vehicles · ₹174 per tag · saves ₹49</div>

                  <ul className="space-y-3 mb-10 flex-1">
                    {[
                      "2 waterproof QR tags, shipped together",
                      "Everything in Solo, for both vehicles",
                      "₹49 cheaper than buying two Solo tags",
                      "Priority support",
                    ].map((f) => (
                      <li key={f} className="flex items-start gap-3 text-sm text-white/60">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                          <circle cx="8" cy="8" r="7" fill="#1A9D20" opacity="0.2"/>
                          <path d="M5 8l2 2 4-4" stroke="#1A9D20" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <a href={`${APP_URL}/register-owner`} className="block text-center bg-[#1A9D20] hover:bg-[#158018] text-white font-bold py-3 rounded-xl transition-colors text-sm">
                    Get Duo Pack
                  </a>
                </div>
              </AnimateIn>

            </div>

            {/* Fleet */}
            <AnimateIn delay={180}>
              <div className="rounded-2xl bg-gray-50 border border-gray-100 px-8 py-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-4">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#001935" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 mt-0.5 opacity-50">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <div>
                    <span className="font-bold text-[#001935]">Fleet: 5 or more vehicles</span>
                    <p className="text-sm text-[#495B7B] mt-1">Bulk pricing, fleet dashboard, batch tag issuance, dedicated account support.</p>
                  </div>
                </div>
                <a href="mailto:support@parktag.me" className="flex-shrink-0 text-sm font-bold text-[#001935] border-2 border-[#001935] px-6 py-2.5 rounded-xl hover:bg-[#001935] hover:text-white transition-colors whitespace-nowrap text-center">
                  Talk to us
                </a>
              </div>
            </AnimateIn>

          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="bg-gray-50 py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <p className="text-center text-xs font-semibold tracking-[0.2em] uppercase text-[#495B7B] mb-4">FAQ</p>
            <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-[#001935] mb-12 tracking-tight leading-snug">
              If your question isn&apos;t answered here,{" "}
              please <Link href="/contact" className="text-[#1A9D20] hover:underline">contact us</Link>{" "}
              using the email form.
            </h2>
            <FaqAccordion />
          </div>
        </section>

        {/* ── CTA ── */}
        <section data-nav-dark className="bg-[#001935] py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <AnimateIn>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight">
                Never miss a call about<br />your parked vehicle again.
              </h2>
              <p className="text-white/50 mb-8">Join vehicle owners across India who park with confidence.</p>
              <a href={`${APP_URL}/register-owner`} className="inline-block bg-[#1A9D20] hover:bg-[#158018] text-white font-bold px-8 py-4 rounded-xl transition-colors text-base">
                Get Your ParkTag →
              </a>
              <p className="text-white/25 text-sm mt-4">Starting at ₹199 · Ships across India · No subscription</p>
            </AnimateIn>
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-[#03162D] py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid sm:grid-cols-4 gap-8 mb-10">
            <div className="sm:col-span-2">
              <div className="mb-3">
                <img src="/dark-logo.png" alt="ParkTag" style={{ height: "42px", width: "auto" }} />
              </div>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs">Smart vehicle connection system built for modern India. Simple, secure, accessible.</p>
              <a href="mailto:support@parktag.me" className="text-[#1A9D20] text-sm mt-3 inline-block hover:text-white transition-colors">support@parktag.me</a>
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
