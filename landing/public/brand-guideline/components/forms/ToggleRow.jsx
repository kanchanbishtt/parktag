import React from "react";

export function ToggleRow({ title, description, checked = false, onChange, style, ...rest }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-12)",
        padding: "14px 16px",
        background: checked ? "var(--pt-red-50)" : "#F9FAFB",
        border: `1.5px solid ${checked ? "var(--accent)" : "var(--border-admin)"}`,
        borderRadius: "var(--radius-lg)",
        cursor: "pointer",
        transition: "background var(--duration-base), border-color var(--duration-base)",
        ...style,
      }}
      {...rest}
    >
      <span>
        <span style={{ display: "block", fontSize: "var(--text-base)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)" }}>{title}</span>
        {description ? (
          <span style={{ display: "block", marginTop: 3, fontSize: "var(--text-xs-plus)", color: "var(--text-admin-muted)", fontWeight: "var(--weight-regular)" }}>{description}</span>
        ) : null}
      </span>
      <span style={{ position: "relative", flexShrink: 0 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          style={{ opacity: 0, position: "absolute", width: 0, height: 0 }}
        />
        <span
          style={{
            display: "block",
            width: 44,
            height: 24,
            background: checked ? "var(--accent)" : "var(--pt-gray-300)",
            borderRadius: 12,
            transition: "background var(--duration-slower)",
            position: "relative",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 2,
              left: checked ? 22 : 2,
              width: 20,
              height: 20,
              background: "#fff",
              borderRadius: "50%",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              transition: "left var(--duration-slower)",
            }}
          />
        </span>
      </span>
    </label>
  );
}
