import React from "react";

const TONES = {
  default: { borderRadius: "var(--radius-card)", padding: "var(--pad-card)", boxShadow: "var(--shadow-card)", border: "1px solid var(--border-hairline)" },
  soft: { borderRadius: "var(--radius-2xl)", padding: "20px", boxShadow: "var(--shadow-soft)", border: "1.5px solid var(--border-default)" },
  premium: { borderRadius: "var(--radius-card-premium)", padding: "22px 18px", boxShadow: "var(--shadow-premium)", border: "1px solid var(--border-strong)" },
};

export function Card({ tone = "default", title, sub, icon, children, style, ...rest }) {
  return (
    <section style={{ background: "var(--surface-card)", ...TONES[tone], ...style }} {...rest}>
      {icon ? <div style={{ marginBottom: "var(--space-16)" }}>{icon}</div> : null}
      {title ? (
        <h3 style={{ margin: "0 0 var(--space-8)", fontFamily: "var(--font-display)", fontSize: "var(--text-2xl)", fontWeight: "var(--weight-heavy)", lineHeight: "var(--leading-heading)", letterSpacing: "var(--tracking-tighter)", color: "var(--text-strong)" }}>{title}</h3>
      ) : null}
      {sub ? (
        <p style={{ margin: "0 0 var(--space-20)", fontSize: "var(--text-md)", lineHeight: "var(--leading-body)", color: "var(--text-muted)" }}>{sub}</p>
      ) : null}
      {children}
    </section>
  );
}
