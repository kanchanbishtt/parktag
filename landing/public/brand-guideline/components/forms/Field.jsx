import React from "react";

export function Field({ label, hint, surface = "owner", wide = false, children, style, ...rest }) {
  const owner = surface === "owner";
  return (
    <label
      style={{
        display: "grid",
        gap: "var(--space-5)",
        fontFamily: "var(--font-ui)",
        fontSize: owner ? "var(--text-base-plus)" : "var(--text-sm-plus)",
        fontWeight: "var(--weight-semibold)",
        color: owner ? "var(--text-strong)" : "var(--pt-gray-700)",
        ...(wide ? { gridColumn: "1 / -1" } : null),
        ...style,
      }}
      {...rest}
    >
      <span>{label}</span>
      {children}
      {hint ? (
        <span style={{ fontSize: "var(--text-xs-plus)", fontWeight: "var(--weight-regular)", color: "var(--text-admin-muted)" }}>{hint}</span>
      ) : null}
    </label>
  );
}
