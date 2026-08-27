import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { Field } from "../../components/forms/Field.jsx";
import { Input } from "../../components/forms/Input.jsx";
import { Badge } from "../../components/status/Badge.jsx";
import { DataTable } from "../../components/data/DataTable.jsx";
import { Icon } from "../../components/icons/Icon.jsx";

const ADMINS = [
  { email: "girish@parktag.me", role: "Owner", added: "12 Jun 2026" },
  { email: "ops@parktag.me", role: "Admin", added: "02 Jul 2026" },
  { email: "print.vendor@parktag.me", role: "Print only", added: "18 Jul 2026" },
];

export function AdminsScreen() {
  return (
    <>
      <PageHeader eyebrow="Monitoring" title="Admin management" sub="Who can issue tags, review the queue, and see owner data." />

      <AdminCard style={{ maxWidth: "var(--width-form)" }} title="Invite an admin" sub="They sign in with Google using this address.">
        <div style={{ display: "grid", gap: "var(--space-14)" }}>
          <Field surface="admin" label="Email address">
            <Input surface="admin" type="email" placeholder="name@parktag.me" />
          </Field>
          <AdminButton style={{ width: "fit-content" }} icon={<Icon name="plus" size={16} strokeWidth={2.5} />}>Send invite</AdminButton>
        </div>
      </AdminCard>

      <AdminCard title="Current admins" badge={<Badge tone="gray">{ADMINS.length}</Badge>}>
        <DataTable
          minWidth={520}
          columns={["Email", "Role", "Added", "Actions"]}
          rows={ADMINS.map((a) => [
            <span style={{ fontWeight: "var(--weight-bold)" }}>{a.email}</span>,
            <Badge tone={a.role === "Owner" ? "red" : "gray"}>{a.role}</Badge>,
            <span style={{ color: "var(--text-admin-muted)" }}>{a.added}</span>,
            <AdminButton variant="red" style={{ padding: "5px 10px", fontSize: "var(--text-xs-plus)" }}>Revoke</AdminButton>,
          ])}
        />
      </AdminCard>
    </>
  );
}
