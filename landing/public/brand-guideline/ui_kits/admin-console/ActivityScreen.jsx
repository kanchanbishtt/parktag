import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { IconTile } from "../../components/tag/IconTile.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { REGISTRATIONS, REQUESTS } from "./data.js";

function Feed({ items, last }) {
  return items.map((it, i) => (
    <div key={i} style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", padding: "12px 0", borderBottom: i === items.length - 1 ? "none" : "1px solid var(--pt-hairline)" }}>
      <IconTile size="sm" tone={i % 2 ? "soft" : "accent"}>{it.icon}</IconTile>
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--text-admin)" }}>{it.title}</p>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-admin-muted)" }}>{it.meta}</p>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        {it.right}
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-admin-faint)", minWidth: 74, textAlign: "right" }}>{it.when}</span>
      </div>
    </div>
  ));
}

export function ActivityScreen() {
  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Activity feed" sub="Latest owner registrations and contact requests across the platform." />

      <AdminCard title="Recent Registrations" sub="New owners and their tags.">
        <Feed items={REGISTRATIONS.map((r) => ({
          icon: <Icon name="user" size={16} />,
          title: r.name + " claimed " + r.tag,
          meta: r.plate + " · " + r.contact,
          when: r.when,
        }))} />
      </AdminCard>

      <AdminCard title="Recent Contact Requests" sub="Scanner activity and contact attempts.">
        <Feed items={REQUESTS.map((r) => ({
          icon: <Icon name={r.channel === "WhatsApp" ? "share" : "activity"} size={16} />,
          title: r.reason,
          meta: r.plate + " · " + r.channel,
          when: r.when,
          right: <Pill tone={r.state === "no answer" ? "deleted" : "active"}>{r.state}</Pill>,
        }))} />
      </AdminCard>
    </>
  );
}
