import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { Badge } from "../../components/status/Badge.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { EmptyState } from "../../components/status/EmptyState.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { PRINT_QUEUE, PRINTED_QUEUE } from "./data.js";

export function PrintQueueScreen() {
  const [printed, setPrinted] = React.useState(false);
  const [queue, setQueue] = React.useState(PRINT_QUEUE);
  const [done, setDone] = React.useState(PRINTED_QUEUE);
  const rows = printed ? done : queue;

  function markPrinted(id) {
    const tag = queue.find((t) => t.id === id);
    setQueue(queue.filter((t) => t.id !== id));
    if (tag) setDone([tag, ...done]);
  }

  return (
    <>
      <PageHeader eyebrow="Print Queue" title="Unprinted tags" sub="Review sticker-ready unclaimed tags and prepare them for the printing company." />

      <AdminCard
        title="Current queue"
        badge={<Badge tone="gray">{queue.length}</Badge>}
        sub="Unclaimed tags ready for the printing vendor."
        actions={
          <>
            <AdminButton icon={<Icon name="download" size={15} />}>Export QRs</AdminButton>
            <AdminButton variant="red">Clear all unprinted</AdminButton>
            <AdminButton variant="ghost">Refresh</AdminButton>
          </>
        }
      >
        <div style={{ display: "flex", gap: "var(--space-8)", margin: "4px 0 var(--space-16)" }}>
          <AdminButton variant={printed ? "ghost" : "primary"} onClick={() => setPrinted(false)}>To Print</AdminButton>
          <AdminButton variant={printed ? "primary" : "ghost"} onClick={() => setPrinted(true)}>Printed · awaiting claim</AdminButton>
        </div>

        {rows.length === 0 ? (
          <EmptyState>Nothing waiting to print yet.</EmptyState>
        ) : (
          rows.map((t, i) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-12)", padding: "14px 0", borderBottom: i === rows.length - 1 ? "none" : "1px solid var(--pt-hairline)" }}>
              <span style={{ width: 44, height: 44, borderRadius: "var(--radius-sm)", border: "2px dashed var(--border-admin)", display: "grid", placeItems: "center", color: "var(--text-admin-faint)", flexShrink: 0 }}>
                <Icon name="qr" size={18} />
              </span>
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <p style={{ margin: 0, fontFamily: "var(--font-plate)", fontSize: "var(--text-md)", fontWeight: "var(--weight-bold)", color: "var(--text-admin)" }}>{t.id}</p>
                <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-admin-muted)" }}>{t.batch} · {t.label} · requested {t.requested}</p>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "var(--space-8)", flexShrink: 0 }}>
                <Pill tone={t.sticker ? "active" : "deleted"}>{t.sticker ? "Sticker requested" : "Digital only"}</Pill>
                {printed ? (
                  <Pill tone="premium">Awaiting claim</Pill>
                ) : (
                  <AdminButton variant="secondary" onClick={() => markPrinted(t.id)}>Mark printed</AdminButton>
                )}
              </div>
            </div>
          ))
        )}
      </AdminCard>
    </>
  );
}
