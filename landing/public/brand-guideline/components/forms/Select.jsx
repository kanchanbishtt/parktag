import React from "react";

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236B7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")";

export function Select({ surface = "owner", children, style, ...rest }) {
  const [focus, setFocus] = React.useState(false);
  const admin = surface === "admin";
  return (
    <select
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        width: "100%",
        appearance: "none",
        backgroundImage: CHEVRON,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 14px center",
        backgroundColor: focus ? "#fff" : "var(--pt-bg)",
        border: `1.5px solid ${focus ? "var(--accent)" : admin ? "var(--border-admin)" : "var(--border-default)"}`,
        borderRadius: admin ? "var(--radius-button-admin)" : "var(--radius-input)",
        padding: admin ? "9px 36px 9px 12px" : "11px 36px 11px 13px",
        fontFamily: "var(--font-ui)",
        fontSize: admin ? "var(--text-md)" : "var(--text-md-plus)",
        color: "var(--text-strong)",
        outline: "none",
        cursor: "pointer",
        ...style,
      }}
      {...rest}
    >
      {children}
    </select>
  );
}
