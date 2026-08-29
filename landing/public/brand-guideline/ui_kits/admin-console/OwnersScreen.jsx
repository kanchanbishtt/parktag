import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { DataTable } from "../../components/data/DataTable.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { OWNERS } from "./data.js";

export function OwnersScreen() {
  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Owner accounts" sub="Review owners, tag counts, active tags, and activity." />
      <AdminCard title="All owners" sub="Every registered owner on the platform." actions={<AdminButton variant="ghost">Export CSV</AdminButton>}>
        <DataTable
          columns={["Owner", "Email", "Mobile", "Tags", "Active", "Plan", "Joined"]}
          rows={OWNERS.map((o) => [
            <span style={{ fontWeight: "var(--weight-bold)" }}>{o.name}</span>,
            <span style={{ color: "var(--text-admin-muted)" }}>{o.email}</span>,
            <span style={{ fontFamily: "var(--font-plate)", fontSize: "var(--text-sm-plus)" }}>{o.mobile}</span>,
            o.tags,
            o.active,
            <Pill tone={o.plan}>{o.plan}</Pill>,
            <span style={{ color: "var(--text-admin-muted)" }}>{o.joined}</span>,
          ])}
        />
      </AdminCard>
    </>
  );
}
