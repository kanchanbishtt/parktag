import React from "react";

const TONES = {
  info: { color: "var(--text-muted)" },
  success: { color: "var(--accent)" },
  error: { color: "var(--pt-danger)" },
  adminInfo: { color: "var(--text-admin-muted)" },
};

export function StatusText({ tone = "info", center = false, children, style, ...rest }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "8px 0",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-sm-plus)",
        fontWeight: "var(--weight-semibold)",
        textAlign: center ? "center" : "left",
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </p>
  );
}
