import React from "react";

const TONES = {
  active: { background: "var(--pt-red-200)", color: "var(--accent-ink)" },
  inactive: { background: "var(--pt-danger-bg)", color: "var(--pt-danger-strong)" },
  premium: { background: "var(--pt-warn-bg)", color: "var(--pt-warn)" },
  free: { background: "var(--pt-red-200)", color: "#3730A3" },
  deleted: { background: "var(--pt-gray-100)", color: "var(--pt-gray-500)" },
};

export function Pill({ tone = "active", children, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-2xs)",
        fontWeight: "var(--weight-heavy)",
        padding: "2px 9px",
        borderRadius: "var(--radius-pill)",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
