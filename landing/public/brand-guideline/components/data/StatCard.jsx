import React from "react";

export function StatCard({ label, value, style, ...rest }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-card-admin)",
        border: "1px solid var(--border-admin)",
        padding: "18px 20px",
        boxShadow: "var(--shadow-admin-card)",
        ...style,
      }}
      {...rest}
    >
      <p style={{ margin: "0 0 var(--space-6)", fontSize: "var(--text-xs-plus)", fontWeight: "var(--weight-semibold)", textTransform: "uppercase", letterSpacing: "var(--tracking-caps)", color: "var(--text-admin-muted)" }}>{label}</p>
      <p style={{ margin: 0, font: "var(--type-stat)", color: "var(--text-admin)" }}>{value}</p>
    </div>
  );
}
