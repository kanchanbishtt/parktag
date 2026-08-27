import React from "react";

export function MenuDrawer({ open = false, name, email, onClose, children, style, ...rest }) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 100 }} />
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "var(--drawer-width)",
          background: "var(--surface-card)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          boxShadow: "var(--shadow-drawer)",
          ...style,
        }}
        {...rest}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "24px 20px 16px", borderBottom: "1px solid var(--border-default)" }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: "var(--text-lg)", fontWeight: "var(--weight-heavy)", color: "var(--text-strong)" }}>{name}</p>
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{email}</p>
          </div>
          <button onClick={onClose} aria-label="Close menu" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "var(--space-6)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "var(--space-12)", gap: "var(--space-4)" }}>{children}</div>
      </nav>
    </>
  );
}

export function MenuItem({ icon, tone = "default", active = false, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-12)",
        padding: "12px 14px",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-md-plus)",
        fontWeight: "var(--weight-semibold)",
        color: active ? "var(--accent-ink)" : tone === "danger" ? "var(--pt-danger)" : "var(--text-strong)",
        background: active ? "var(--pt-red-200)" : hover ? "var(--pt-bg)" : "none",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        transition: "background var(--duration-fast)",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
