import React from "react";

export function EmptyState({ surface = "admin", children, style, ...rest }) {
  const admin = surface === "admin";
  return (
    <p
      style={{
        margin: 0,
        textAlign: "center",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-base)",
        color: admin ? "var(--text-admin-faint)" : "var(--text-muted)",
        padding: admin ? "24px 0" : "8px 0",
        ...style,
      }}
      {...rest}
    >
      {children}
    </p>
  );
}
