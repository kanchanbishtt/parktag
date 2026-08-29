import React from "react";

const TONES = {
  active: { background: "var(--pt-red-100)", color: "var(--accent)" },
  amber: { background: "var(--pt-red-200)", color: "var(--accent)" },
  red: { background: "var(--pt-danger-bg)", color: "var(--pt-danger)" },
  gray: { background: "var(--pt-gray-100)", color: "var(--pt-gray-700)" },
  admin: { background: "var(--pt-danger-bg)", color: "var(--pt-danger)" },
  verified: { background: "var(--pt-success-bg)", color: "var(--pt-success)", border: "1px solid var(--pt-success-border)" },
  glass: { background: "rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.14)" },
  glassWarn: { background: "rgba(251,191,36,0.18)", color: "#FCD34D", border: "1px solid rgba(251,191,36,0.30)" },
  glassSuccess: { background: "rgba(34,197,94,0.18)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.30)" },
};

export function Badge({ tone = "gray", icon, children, style, ...rest }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-5)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-xs)",
        fontWeight: "var(--weight-bold)",
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        whiteSpace: "nowrap",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
