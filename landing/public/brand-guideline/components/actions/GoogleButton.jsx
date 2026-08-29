import React from "react";

export function GoogleButton({ children = "Continue with Google", style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-10)",
        width: "100%",
        padding: "11px 16px",
        borderRadius: "var(--radius-lg)",
        border: `1.5px solid ${hover ? "var(--pt-gray-300)" : "var(--border-admin)"}`,
        background: "#fff",
        color: "var(--pt-gray-900)",
        fontFamily: "var(--font-ui)",
        fontSize: "0.92rem",
        fontWeight: "var(--weight-semibold)",
        cursor: "pointer",
        boxShadow: hover ? "var(--shadow-admin-hover)" : "0 1px 3px rgba(0,0,0,0.06)",
        transition: "box-shadow var(--duration-base), border-color var(--duration-base)",
        ...style,
      }}
      {...rest}
    >
      <svg width="20" height="20" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M47.532 24.552c0-1.636-.134-3.218-.389-4.742H24.48v8.978h12.985c-.56 3.016-2.255 5.574-4.806 7.288v6.056h7.779c4.548-4.19 7.094-10.36 7.094-17.58z" fill="#4285F4" />
        <path d="M24.48 48c6.516 0 11.982-2.162 15.977-5.868l-7.779-6.056c-2.157 1.446-4.914 2.298-8.198 2.298-6.304 0-11.642-4.258-13.55-9.982H2.906v6.248C6.882 42.918 15.116 48 24.48 48z" fill="#34A853" />
        <path d="M10.93 28.392A14.464 14.464 0 0 1 9.9 24c0-1.524.261-3.004.73-4.392v-6.248H2.906A23.988 23.988 0 0 0 .48 24c0 3.878.928 7.546 2.426 10.64l8.024-6.248z" fill="#FBBC05" />
        <path d="M24.48 9.626c3.552 0 6.74 1.222 9.248 3.622l6.942-6.942C36.456 2.392 30.992 0 24.48 0 15.116 0 6.882 5.082 2.906 13.36l8.024 6.248c1.908-5.724 7.246-9.982 13.55-9.982z" fill="#EA4335" />
      </svg>
      {children}
    </button>
  );
}

export function OrDivider({ label = "OR", style }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", marginTop: "var(--space-20)", ...style }}>
      <span style={{ flex: 1, height: 1, background: "var(--border-admin)" }} />
      <span style={{ fontSize: "0.78rem", color: "var(--text-admin-faint)", fontWeight: "var(--weight-semibold)", letterSpacing: "var(--tracking-caps)" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border-admin)" }} />
    </div>
  );
}
