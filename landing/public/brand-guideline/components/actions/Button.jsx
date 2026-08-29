import React from "react";

const BASE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-8)",
  border: "none",
  borderRadius: "var(--radius-button)",
  padding: "14px 20px",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--text-md-plus)",
  fontWeight: "var(--weight-bold)",
  cursor: "pointer",
  textDecoration: "none",
  transition: "transform var(--duration-fast), box-shadow var(--duration-fast), background var(--duration-base)",
};

const VARIANTS = {
  primary: {
    background: "var(--accent)",
    color: "#fff",
    boxShadow: "var(--shadow-accent)",
    hover: { background: "var(--accent-hover)", boxShadow: "var(--shadow-accent-hover)" },
  },
  activate: {
    background: "var(--action-dark)",
    color: "#fff",
    padding: "15px 24px",
    fontSize: "var(--text-lg)",
    hover: { background: "var(--action-dark-hover)", transform: "var(--lift-hover)" },
  },
  whatsapp: {
    background: "var(--pt-gradient-whatsapp)",
    color: "#fff",
    padding: "18px 20px",
    borderRadius: "var(--radius-2xl)",
    boxShadow: "var(--shadow-whatsapp)",
    hover: { transform: "var(--lift-hover)" },
  },
  call: {
    background: "var(--pt-gradient-call)",
    color: "#fff",
    padding: "18px 20px",
    borderRadius: "var(--radius-2xl)",
    border: "1px solid rgba(255,255,255,0.09)",
    boxShadow: "var(--shadow-call)",
    hover: { transform: "var(--lift-hover)" },
  },
  outline: {
    background: "var(--surface-card)",
    color: "var(--text-strong)",
    border: "1.5px solid var(--border-default)",
    boxShadow: "var(--shadow-soft)",
    hover: { borderColor: "var(--pt-gray-300)", background: "var(--pt-bg)" },
  },
};

export function Button({
  variant = "primary",
  full = false,
  loading = false,
  disabled = false,
  icon = null,
  sub = null,
  as = "button",
  children,
  style,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const v = VARIANTS[variant] || VARIANTS.primary;
  const { hover: hoverStyle, ...rest_v } = v;
  const Tag = as;
  return (
    <Tag
      disabled={Tag === "button" ? disabled || loading : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...BASE,
        ...rest_v,
        ...(hover && !disabled && !loading ? hoverStyle : null),
        ...(full ? { width: "100%" } : null),
        ...(sub ? { flexDirection: "column", gap: "var(--space-2)" } : null),
        ...(disabled || loading ? { opacity: 0.6, cursor: "not-allowed" } : null),
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <Spinner />
      ) : (
        <>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-8)" }}>
            {icon}
            {children}
          </span>
          {sub ? (
            <span style={{ fontSize: "var(--text-xs-plus)", fontWeight: "var(--weight-regular)", opacity: 0.85 }}>{sub}</span>
          ) : null}
        </>
      )}
    </Tag>
  );
}

function Spinner() {
  return (
    <span
      style={{
        width: 18,
        height: 18,
        border: "2.5px solid rgba(255,255,255,0.35)",
        borderTopColor: "currentColor",
        borderRadius: "50%",
        animation: "pt-spin-inline var(--duration-spin) linear infinite",
      }}
    />
  );
}
