"use client";

import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faTag,
  faQrcode,
  faCommentDots,
  faShieldHalved,
  faCheck,
} from "@fortawesome/free-solid-svg-icons";

// Copy rewritten so each step has a distinct job. Three of the four previously
// ended on privacy — "your number is hidden", "neither side ever sees the
// other's number", "you stay private" — so by step three the reader had learned
// nothing new. Privacy is now made once, in step three where the mechanism is,
// and step four is about control instead, which is the thing privacy buys you.
//
// The icons replace numbered boxes. A number tells you the order, which the
// rail already does; an icon tells you what the step IS, which is the part a
// visitor skimming for five seconds actually needs.
const STEPS: { icon: IconDefinition; title: string; body: string }[] = [
  {
    icon: faTag,
    title: "Attach your ParkTag",
    body: "Place the tag on your glass and activate it once. That is the whole setup.",
  },
  {
    icon: faQrcode,
    title: "They scan the tag",
    body: "No app, no sign-up. Any phone camera opens it.",
  },
  {
    icon: faCommentDots,
    title: "You get the message",
    body: "The call or message routes through ParkTag, so neither side sees a number.",
  },
  {
    icon: faShieldHalved,
    title: "You stay in control",
    body: "Answer, ignore, or switch the tag off from your dashboard.",
  },
];

export function HowItWorksSteps() {
  // -1 means "nothing reached yet": every step muted, rail unfilled. Scrolling
  // into the section is what starts the story, rather than it having already
  // happened before the reader arrived.
  const [active, setActive] = useState(-1);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    // Reduced motion runs no observer and no rail animation. The steps are
    // all rendered in the reached state by the CSS below, so nothing is muted
    // or hidden for them — they lose the progression, not the content.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // A step becomes current when it crosses the middle of the viewport, which
    // is where someone reading actually is — not when it first appears at the
    // bottom edge, which would light up a step still half off-screen.
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const i = itemRefs.current.indexOf(entry.target as HTMLLIElement);
          // Only ever moves forward. Scrolling back up should leave the
          // completed steps completed rather than un-telling the story.
          setActive((prev) => (i > prev ? i : prev));
        });
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
    );

    itemRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // The rail fills to the centre of the current node, so the line always ends
  // on the thing it is pointing at rather than short of it or past it.
  const fill = active < 0 ? 0 : ((active + 0.5) / STEPS.length) * 100;

  return (
    <ol className="relative">
      {/* The rail. Left-aligned to the centre of the 56px nodes on mobile and
          the 64px ones from sm up. */}
      <div
        aria-hidden="true"
        className="absolute top-8 bottom-8 w-px bg-white/10 left-[27px] sm:left-[31px]"
      />
      <div
        aria-hidden="true"
        className="absolute top-8 w-px bg-[#FF2700] left-[27px] sm:left-[31px] transition-[height] duration-700 ease-out"
        style={{ height: `calc((100% - 4rem) * ${fill / 100})` }}
      />

      {STEPS.map(({ icon, title, body }, i) => {
        const done = i < active;
        const on = i === active;
        const upcoming = i > active;

        return (
          <li
            key={title}
            ref={(el) => { itemRefs.current[i] = el; }}
            aria-current={on ? "step" : undefined}
            className="relative flex items-start gap-5 sm:gap-7 pb-8 last:pb-0 motion-safe:animate-[pt-step-in_500ms_ease-out_both]"
            style={{ animationDelay: `${i * 90}ms` }}
          >
            {/* Node. Solid red once reached, hollow while upcoming, with a soft
                ring on the current one — one motion for the whole section
                rather than a different flourish per step. */}
            <span
              className={[
                "relative z-10 flex-shrink-0 flex items-center justify-center rounded-full",
                "h-14 w-14 sm:h-16 sm:w-16 transition-all duration-500",
                upcoming
                  ? "bg-[#0B1B33] border border-white/15 text-white/35 motion-reduce:bg-[#FF2700] motion-reduce:text-white motion-reduce:border-[#FF2700]"
                  : "bg-[#FF2700] text-white border border-[#FF2700]",
                on ? "ring-8 ring-[#FF2700]/15" : "",
              ].join(" ")}
            >
              <FontAwesomeIcon
                icon={done ? faCheck : icon}
                className="h-5 w-5 sm:h-6 sm:w-6"
              />
            </span>

            <div className="pt-3 sm:pt-4">
              <p
                className={[
                  "text-[11px] font-bold tracking-[0.18em] uppercase mb-1.5 transition-colors duration-500",
                  upcoming ? "text-white/25 motion-reduce:text-[#FF2700]" : "text-[#FF2700]",
                ].join(" ")}
              >
                Step {String(i + 1).padStart(2, "0")}
              </p>
              <h3
                className={[
                  "font-bold text-lg sm:text-xl mb-1.5 transition-colors duration-500",
                  upcoming ? "text-white/40 motion-reduce:text-white" : "text-white",
                ].join(" ")}
              >
                {title}
              </h3>
              <p
                className={[
                  "leading-relaxed max-w-md transition-colors duration-500",
                  upcoming ? "text-white/25 motion-reduce:text-white/60" : "text-white/60",
                ].join(" ")}
              >
                {body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
