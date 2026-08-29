import React from "react";

const BASE = {
  padding: "10px 18px",
  borderRadius: "var(--radius-button-admin)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-base-plus)",
  fontWeight: "var(--weight-bold)",
  cursor: "pointer",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-6)",
  transition: "background var(--duration-fast), transform var(--duration-instant)",
};

const VARIANTS = {
  primary: { background: "var(--action-dark)", color: "#fff", hover: { background: "var(--action-dark-hover)" } },
  secondary: {
    background: "var(--pt-gray-100)",
    color: "var(--pt-gray-700)",
    border: "1px solid var(--border-admin)",
    hover: { background: "var(--pt-gray-200)" },
  },
  ghost: { background: "var(--pt-gray-100)", color: "var(--pt-gray-700)", hover: { background: "var(--pt-gray-200)" } },
  red: {
    background: "var(--pt-danger-bg)",
    color: "var(--pt-danger)",
    border: "1px solid var(--pt-danger-border)",
    hover: { background: "var(--pt-danger-border)" },
  },
};

export function AdminButton({ variant = "primary", full = false, loading = false, icon = null, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const { hover: hoverStyle, ...v } = VARIANTS[variant] || VARIANTS.primary;
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{
        ...BASE,
        ...v,
        ...(hover ? hoverStyle : null),
        ...(press ? { transform: "scale(var(--press-scale))" } : null),
        ...(full ? { width: "100%", justifyContent: "center" } : null),
        ...(loading ? { opacity: 0.7, pointerEvents: "none" } : null),
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
