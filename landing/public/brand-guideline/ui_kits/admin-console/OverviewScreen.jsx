import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { StatCard } from "../../components/data/StatCard.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { Badge } from "../../components/status/Badge.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { COUNTS, REGISTRATIONS, REQUESTS } from "./data.js";

function Row({ title, meta, right, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", padding: "14px 0", borderBottom: last ? "none" : "1px solid var(--pt-hairline)" }}>
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--text-admin)" }}>{title}</p>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-admin-muted)" }}>{meta}</p>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-10)", flexShrink: 0 }}>{right}</div>
    </div>
  );
}

export function OverviewScreen({ onNavigate }) {
  return (
    <>
      <PageHeader eyebrow="Overview" title="Platform snapshot" sub="Owners, tags, requests, and print queue at a glance." />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "var(--space-14)", marginBottom: "var(--space-24)" }}>
        {COUNTS.map((c) => <StatCard key={c.label} label={c.label} value={c.value} />)}
      </div>

      <AdminCard
        title="Recent Registrations"
        sub="Newest owners and their tags."
        actions={<AdminButton variant="ghost" onClick={() => onNavigate("owners")}>View all owners</AdminButton>}
      >
        {REGISTRATIONS.map((r, i) => (
          <Row
            key={r.tag}
            title={r.name}
            meta={r.contact}
            last={i === REGISTRATIONS.length - 1}
            right={
              <>
                <span style={{ fontFamily: "var(--font-plate)", fontSize: "var(--text-sm-plus)", fontWeight: "var(--weight-bold)", letterSpacing: "0.04em" }}>{r.plate}</span>
                <Pill tone="active">{r.tag}</Pill>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-admin-faint)", minWidth: 74, textAlign: "right" }}>{r.when}</span>
              </>
            }
          />
        ))}
      </AdminCard>

      <AdminCard
        title="Recent Contact Requests"
        badge={<Badge tone="gray">last 24h</Badge>}
        sub="Scanner activity across every active tag."
        actions={<AdminButton variant="ghost" onClick={() => onNavigate("activity")}>Open activity feed</AdminButton>}
      >
        {REQUESTS.map((r, i) => (
          <Row
            key={r.plate + r.when}
            title={r.reason}
            meta={r.plate + " · " + r.channel}
            last={i === REQUESTS.length - 1}
            right={
              <>
                <Pill tone={r.state === "no answer" ? "deleted" : "active"}>{r.state}</Pill>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--text-admin-faint)", minWidth: 74, textAlign: "right" }}>{r.when}</span>
              </>
            }
          />
        ))}
      </AdminCard>
    </>
  );
}
