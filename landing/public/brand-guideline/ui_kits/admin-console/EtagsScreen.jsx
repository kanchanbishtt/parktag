import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { DataTable } from "../../components/data/DataTable.jsx";
import { Input } from "../../components/forms/Input.jsx";
import { Select } from "../../components/forms/Select.jsx";
import { Checkbox } from "../../components/forms/Checkbox.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { EmptyState } from "../../components/status/EmptyState.jsx";
import { ETAGS } from "./data.js";

export function EtagsScreen() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [showDeleted, setShowDeleted] = React.useState(false);

  const rows = ETAGS.filter((t) => {
    if (!showDeleted && t.status === "deleted") return false;
    if (status && t.status !== status) return false;
    if (!q) return true;
    const hay = (t.id + " " + t.plate + " " + t.owner).toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <>
      <PageHeader eyebrow="Management" title="E-Tags" sub="Every tag issued, claimed or otherwise — searchable by vehicle, tag ID or owner." />

      <div style={{ display: "flex", gap: "var(--space-10)", marginBottom: "var(--space-14)", flexWrap: "wrap", alignItems: "center" }}>
        <Input
          surface="admin"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by vehicle number, E-Tag ID, owner email/mobile…"
          style={{ flex: 1, minWidth: 260, height: 42 }}
        />
        <Select surface="admin" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 170, height: 42 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Checkbox label="Show deleted" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} style={{ fontSize: "var(--text-sm-plus)", color: "var(--text-admin-muted)" }} />
      </div>

      <p style={{ margin: "0 0 var(--space-10)", fontSize: "var(--text-sm-plus)", color: "var(--text-admin-muted)" }}>
        Showing {rows.length} of {ETAGS.length} tags
      </p>

      <AdminCard>
        {rows.length === 0 ? (
          <EmptyState>No tags match that search.</EmptyState>
        ) : (
          <DataTable
            columns={["E-Tag ID", "Vehicle", "Owner", "Status", "Plan", "Contacts", "Created", "Actions"]}
            rows={rows.map((t) => [
              <span style={{ fontFamily: "var(--font-plate)", fontWeight: "var(--weight-bold)" }}>{t.id}</span>,
              <span style={{ fontWeight: "var(--weight-heavy)", letterSpacing: "0.04em" }}>{t.plate}</span>,
              t.owner,
              <Pill tone={t.status}>{t.status}</Pill>,
              <Pill tone={t.plan}>{t.plan}</Pill>,
              t.contacts,
              <span style={{ color: "var(--text-admin-muted)" }}>{t.created}</span>,
              <span style={{ display: "inline-flex", gap: 6 }}>
                <AdminButton variant="secondary" style={{ padding: "5px 10px", fontSize: "var(--text-xs-plus)" }}>Logs</AdminButton>
                <AdminButton variant="red" style={{ padding: "5px 10px", fontSize: "var(--text-xs-plus)" }}>Disable</AdminButton>
              </span>,
            ])}
          />
        )}
      </AdminCard>
    </>
  );
}
