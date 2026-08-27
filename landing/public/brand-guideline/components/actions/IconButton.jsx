import React from "react";

const TONES = {
  onDark: { color: "#fff", padding: "var(--space-6)", borderRadius: "var(--radius-sm)" },
  quiet: { color: "var(--text-muted)", padding: "var(--space-6)", borderRadius: "var(--radius-sm)" },
  chip: {
    color: "var(--pt-gray-500)",
    background: "var(--pt-gray-100)",
    width: 30,
    height: 30,
    borderRadius: "var(--radius-sm)",
  },
};

export function IconButton({ tone = "onDark", label, children, style, ...rest }) {
  return (
    <button
      aria-label={label}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
