import React from "react";

export function DetailRow({ label, icon, value, mono = false, tracked = false, last = false, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        padding: "10px 0",
        borderBottom: last ? "none" : "1px solid rgba(111, 104, 95, 0.14)",
        fontSize: "var(--text-md)",
        ...style,
      }}
      {...rest}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-10)", color: "var(--text-muted)", fontWeight: "var(--weight-semibold)" }}>
        {icon}
        {label}
      </span>
      <span
        style={{
          marginLeft: "auto",
          textAlign: "right",
          fontWeight: "var(--weight-bold)",
          color: "var(--text-strong)",
          ...(mono ? { fontFamily: "var(--font-plate)", fontSize: "var(--text-base)" } : null),
          ...(tracked ? { letterSpacing: "0.08em" } : null),
        }}
      >
        {value}
      </span>
    </div>
  );
}
