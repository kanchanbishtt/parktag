import React from "react";

export function PhoneInput({ prefix = "+91", style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div
      style={{
        display: "flex",
        border: `1.5px solid ${focus ? "var(--accent)" : "var(--border-default)"}`,
        borderRadius: "var(--radius-input)",
        overflow: "hidden",
        background: focus ? "#fff" : "var(--pt-bg)",
        transition: "border-color var(--duration-base)",
        ...style,
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-6)",
          padding: "0 var(--space-12)",
          fontSize: "var(--text-md)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--text-strong)",
          background: "var(--pt-gray-100)",
          borderRight: "1.5px solid var(--border-default)",
          whiteSpace: "nowrap",
        }}
      >
        {prefix}
      </span>
      <input
        type="tel"
        inputMode="numeric"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          flex: 1,
          border: "none",
          background: "transparent",
          outline: "none",
          padding: "11px 12px",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--text-md-plus)",
          color: "var(--text-strong)",
        }}
        {...rest}
      />
    </div>
  );
}
