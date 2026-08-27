import React from "react";

export function ReasonChip({ selected = false, alert = false, icon, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const on = selected || (hover && !alert);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-8)",
        padding: "12px 14px",
        borderRadius: "var(--radius-lg)",
        border: `1.5px solid ${alert ? "#FCA5A5" : on ? "var(--accent)" : "var(--border-default)"}`,
        background: alert ? (hover ? "var(--pt-red-250)" : "var(--pt-red-150)") : on ? "var(--pt-red-150)" : "var(--surface-card)",
        color: alert ? (hover ? "var(--accent-ink)" : "var(--accent-hover)") : on ? "var(--accent-hover)" : "var(--text-strong)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-base)",
        fontWeight: "var(--weight-semibold)",
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "var(--shadow-chip)",
        transition: "all var(--duration-slow) ease",
        ...(alert ? { gridColumn: "span 2" } : null),
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
