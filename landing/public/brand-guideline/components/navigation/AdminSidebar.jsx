import React from "react";

export function AdminSidebar({
  logoSrc = "../../assets/logo/parktag-logo-light-bg.png",
  role = "Admin",
  sections = [],
  active,
  onNavigate,
  footer = null,
  style,
  ...rest
}) {
  return (
    <aside
      style={{
        width: "var(--sidebar-width)",
        flexShrink: 0,
        background: "var(--surface-card)",
        borderRight: "1px solid var(--border-admin)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
        ...style,
      }}
      {...rest}
    >
      <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--border-admin)", display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <img src={logoSrc} alt="ParkTag" style={{ height: 26, width: "auto", display: "block" }} />
        <span style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: "var(--pt-danger)", background: "var(--pt-danger-bg)", padding: "2px 8px", borderRadius: "var(--radius-pill)" }}>{role}</span>
      </div>

      <nav style={{ padding: "var(--space-12)", flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {sections.map((section) => (
          <React.Fragment key={section.label}>
            <span style={{ fontSize: "var(--text-2xs)", fontWeight: "var(--weight-heavy)", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-admin-faint)", padding: "12px 12px 4px" }}>{section.label}</span>
            {section.items.map((item) => {
              const on = item.id === active;
              return (
                <a
                  key={item.id}
                  href={item.href || "#"}
                  onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate(item.id); } }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-10)",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    fontSize: "var(--text-base-plus)",
                    fontWeight: on ? "var(--weight-bold)" : "var(--weight-semibold)",
                    color: on ? "var(--accent-ink)" : "var(--pt-gray-700)",
                    background: on ? "var(--pt-red-200)" : "transparent",
                    textDecoration: "none",
                    transition: "background var(--duration-fast), color var(--duration-fast)",
                  }}
                >
                  {item.icon}
                  {item.label}
                </a>
              );
            })}
          </React.Fragment>
        ))}
      </nav>

      {footer ? (
        <div style={{ padding: "var(--space-12)", borderTop: "1px solid var(--border-admin)", display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>{footer}</div>
      ) : null}
    </aside>
  );
}
