// The eyebrow above a section heading, on every section.
//
// There were three of these doing one job in three ways: "Some Special
// Features" at 11px medium slate on 0.28em tracking, "FAQ" at 12px semibold
// slate on 0.2em, "Pricing" at 12px bold red on tracking-widest. Same role,
// three sizes, two colours, three letter spacings, which is what made the page
// read as assembled rather than designed.
//
// Navy rather than red. Red is the accent and the guideline is firm that it is
// "the single accent — signal, never decoration"; a section label appears six
// times down the page, which makes it chrome, not signal. Spending red on it
// competed with the thing red is for, which is the buy button. Navy is the
// guideline's --pt-navy-800, described as "ink".
//
// `onDark` inverts for the navy sections. A navy pill on a navy background is
// invisible, so it flips to a white fill with navy text: the same object,
// same weight in the hierarchy, read against whatever it sits on. Both
// directions measure 18.2:1.
export function SectionLabel({
  children,
  onDark = false,
  className = "",
}: {
  children: React.ReactNode;
  onDark?: boolean;
  className?: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-4 py-1.5 " +
        "text-[11px] font-bold uppercase tracking-[0.18em] " +
        (onDark ? "bg-white text-[#03162D] " : "bg-[#03162D] text-white ") +
        className
      }
    >
      {children}
    </span>
  );
}
