import React from "react";
import { AdminSidebar } from "../../components/navigation/AdminSidebar.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { NAV } from "./data.js";

export function AdminShell({ active, onNavigate, children }) {
  const sections = NAV.map((s) => ({
    label: s.label,
    items: s.items.map((i) => ({ ...i, icon: <Icon name={i.icon} /> })),
  }));
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--surface-page-admin)", color: "var(--text-admin)", fontFamily: "var(--font-ui)" }}>
      <AdminSidebar
        sections={sections}
        active={active}
        onNavigate={onNavigate}
        footer={
          <>
            <AdminButton variant="ghost" full>Refresh</AdminButton>
            <AdminButton variant="red" full>Sign out</AdminButton>
          </>
        }
      />
      <main style={{ flex: 1, minWidth: 0, padding: "var(--pad-main-admin)", overflowY: "auto" }}>{children}</main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub }) {
  return (
    <div style={{ marginBottom: "var(--space-24)" }}>
      <p style={{ margin: "0 0 4px", fontSize: "var(--text-xs)", fontWeight: "var(--weight-heavy)", textTransform: "uppercase", letterSpacing: "var(--tracking-eyebrow)", color: "var(--accent)" }}>{eyebrow}</p>
      <h1 style={{ margin: "0 0 6px", fontFamily: "var(--font-display)", fontSize: "var(--text-4xl-plus)", fontWeight: "var(--weight-black)", color: "var(--text-admin)" }}>{title}</h1>
      {sub ? <p style={{ margin: 0, fontSize: "var(--text-md)", color: "var(--text-admin-muted)" }}>{sub}</p> : null}
    </div>
  );
}
