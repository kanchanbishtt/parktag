import React from "react";

export function Checkbox({ label, style, ...rest }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-10)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-base-plus)",
        color: "var(--text-strong)",
        cursor: "pointer",
        ...style,
      }}
    >
      <input
        type="checkbox"
        style={{ width: 18, height: 18, accentColor: "var(--accent)", flexShrink: 0, cursor: "pointer" }}
        {...rest}
      />
      {label}
    </label>
  );
}
