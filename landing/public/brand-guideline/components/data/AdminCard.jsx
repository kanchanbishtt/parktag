import React from "react";

export function AdminCard({ title, sub, actions, badge, children, style, ...rest }) {
  return (
    <section
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-card-admin)",
        border: "1px solid var(--border-admin)",
        padding: "var(--pad-card-admin)",
        marginBottom: "var(--space-12)",
        boxShadow: "var(--shadow-admin-card)",
        ...style,
      }}
      {...rest}
    >
      {title || actions ? (
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-12)", flexWrap: "wrap", marginBottom: "var(--space-16)" }}>
          <div>
            <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "var(--space-10)", fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", fontWeight: "var(--weight-heavy)", color: "var(--text-admin)" }}>
              {title}
              {badge}
            </h2>
            {sub ? <p style={{ margin: "4px 0 0", fontSize: "var(--text-sm-plus)", color: "var(--text-admin-muted)" }}>{sub}</p> : null}
          </div>
          {actions ? <div style={{ display: "flex", gap: "var(--space-8)", flexWrap: "wrap" }}>{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}
