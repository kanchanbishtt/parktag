import React from "react";

const SURFACES = {
  owner: {
    padding: "11px 13px",
    borderRadius: "var(--radius-input)",
    background: "var(--pt-bg)",
    fontSize: "var(--text-md-plus)",
    focus: { borderColor: "var(--accent)", background: "#fff" },
  },
  scanner: {
    padding: "12px 14px",
    borderRadius: "var(--radius-input-scanner)",
    background: "#fff",
    fontSize: "var(--text-md-plus)",
    focus: { borderColor: "var(--accent)", boxShadow: "var(--ring-focus)" },
  },
  admin: {
    padding: "9px 12px",
    borderRadius: "var(--radius-button-admin)",
    background: "var(--pt-bg)",
    fontSize: "var(--text-md)",
    borderColor: "var(--border-admin)",
    focus: { borderColor: "var(--accent)", background: "#fff" },
  },
};

const SIZES = {
  plate: { fontFamily: "var(--font-plate)", fontSize: "var(--text-lg-plus)", fontWeight: "var(--weight-bold)", letterSpacing: "0.08em", textTransform: "uppercase" },
  code: { fontSize: "1.2rem", fontWeight: "var(--weight-bold)", letterSpacing: "0.1em", textAlign: "center", minHeight: 56 },
};

export function Input({ surface = "owner", format, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const s = SURFACES[surface] || SURFACES.owner;
  const { focus: focusStyle, ...base } = s;
  return (
    <input
      onFocus={(e) => { setFocus(true); rest.onFocus && rest.onFocus(e); }}
      onBlur={(e) => { setFocus(false); rest.onBlur && rest.onBlur(e); }}
      style={{
        width: "100%",
        border: `1.5px solid ${base.borderColor || "var(--border-default)"}`,
        color: "var(--text-strong)",
        fontFamily: "var(--font-ui)",
        outline: "none",
        transition: "border-color var(--duration-base)",
        ...base,
        ...(format ? SIZES[format] : null),
        ...(focus ? focusStyle : null),
        ...style,
      }}
      {...rest}
    />
  );
}
