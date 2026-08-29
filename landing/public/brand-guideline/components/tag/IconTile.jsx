import React from "react";

const TONES = {
  accent: { background: "var(--pt-red-200)", color: "var(--accent)" },
  soft: { background: "var(--pt-red-100)", color: "var(--accent)" },
  tag: { background: "var(--pt-red-150)", color: "var(--accent-hover)" },
  error: { background: "var(--pt-danger-bg)", color: "var(--pt-danger)" },
};

export function IconTile({ tone = "accent", size = "md", children, style, ...rest }) {
  const md = size === "md";
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: md ? 48 : 34,
        height: md ? 48 : 34,
        borderRadius: md ? "var(--radius-icon-tile)" : "var(--radius-sm)",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
