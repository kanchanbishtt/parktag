import React from "react";

export function NoticeBanner({ icon, children, style, ...rest }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-10)",
        background: "var(--pt-red-200)",
        borderRadius: "var(--radius-lg)",
        padding: "14px 16px",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-base)",
        fontWeight: "var(--weight-medium)",
        lineHeight: "var(--leading-snug)",
        color: "var(--accent-ink)",
        ...style,
      }}
      {...rest}
    >
      {icon ? <span style={{ flexShrink: 0, marginTop: 1 }}>{icon}</span> : null}
      <span>{children}</span>
    </div>
  );
}
