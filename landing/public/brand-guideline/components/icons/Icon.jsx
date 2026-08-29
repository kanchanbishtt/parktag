import React from "react";

/**
 * Every glyph below is the exact path data used inline in the ParkTag pages
 * (24x24 box, 2px stroke, round caps). No new drawings.
 */
export const PT_ICONS = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  tag: "M3 7a2 2 0 0 1 2-2h6l8 8a2 2 0 0 1 0 2.8l-4.2 4.2a2 2 0 0 1-2.8 0L4 12V7Z",
  qr: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h2v2h-2zM18 14h3M14 18v3M18 18h3v3h-3z",
  printer: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  users: "M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  shield: "M12 2L4 6v6c0 5.25 3.5 9.74 8 11 4.5-1.26 8-5.75 8-11V6l-8-4Z",
  chevronRight: "M9 18l6-6-6-6",
  plus: "M12 5v14M5 12h14",
  menu: "M3 6h18M3 12h18M3 18h18",
  close: "M6 6l12 12M6 18L18 6",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  bell: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  login: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  check: "M5 12l4 4L19 7",
  user: "M4 20c0-4 3.6-7 8-7s8 3 8 7",
  alert: "M12 8v4M12 16h.01",
};

/** Circles/rects that some glyphs need in addition to their path. */
const EXTRA = {
  users: <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" />,
  user: <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />,
  tag: <circle cx="7.5" cy="9.5" r="1.5" fill="currentColor" />,
};

export function Icon({ name, size = 16, strokeWidth = 2, style, ...rest }) {
  const d = PT_ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block", ...style }}
      {...rest}
    >
      {name === "shield" ? (
        <>
          <path d={d} stroke="currentColor" strokeWidth={strokeWidth} />
          <path d={PT_ICONS.alert} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
        </>
      ) : (
        <path
          d={d}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {EXTRA[name]}
    </svg>
  );
}
