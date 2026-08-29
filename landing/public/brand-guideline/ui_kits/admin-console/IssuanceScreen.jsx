import React from "react";
import { PageHeader } from "./AdminShell.jsx";
import { AdminCard } from "../../components/data/AdminCard.jsx";
import { AdminButton } from "../../components/actions/AdminButton.jsx";
import { Field } from "../../components/forms/Field.jsx";
import { Input } from "../../components/forms/Input.jsx";
import { Checkbox } from "../../components/forms/Checkbox.jsx";
import { ToggleRow } from "../../components/forms/ToggleRow.jsx";
import { StatusText } from "../../components/status/StatusText.jsx";
import { EmptyState } from "../../components/status/EmptyState.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { Icon } from "../../components/icons/Icon.jsx";

function randomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 3; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

export function IssuanceScreen({ onNavigate }) {
  const [batch, setBatch] = React.useState("BATCH-016");
  const [quantity, setQuantity] = React.useState(10);
  const [label, setLabel] = React.useState("");
  const [sticker, setSticker] = React.useState(true);
  const [premium, setPremium] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);

  function generate() {
    setBusy(true);
    setResult(null);
    setTimeout(() => {
      const n = Math.max(1, Math.min(500, Number(quantity) || 1));
      const tags = Array.from({ length: n }, (_, i) => ({
        id: "PT-0" + (200 + i) + "-" + randomCode(),
        url: "parktag.me/t/" + randomCode().toLowerCase() + (700 + i),
      }));
      setResult({ tags, batch, premium, sticker });
      setBusy(false);
    }, 700);
  }

  return (
    <>
      <PageHeader eyebrow="Batch Issuance" title="Generate QR tags" sub="Create unclaimed tags in bulk for physical sticker printing." />

      <AdminCard style={{ maxWidth: "var(--width-form)" }} title="New batch" sub="Tags are created unowned. Owners claim them by scanning the printed sticker.">
        <div style={{ display: "grid", gap: "var(--space-14)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-12)" }}>
            <Field surface="admin" label="Batch number">
              <Input surface="admin" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="BATCH-001" />
            </Field>
            <Field surface="admin" label="Quantity">
              <Input surface="admin" type="number" min="1" max="500" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <Field surface="admin" label="Batch label">
            <Input surface="admin" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. July 2026 print run" />
          </Field>
          <Checkbox label="Physical sticker requested" checked={sticker} onChange={(e) => setSticker(e.target.checked)} />
          <ToggleRow
            title="Premium access"
            description="Owners who claim this batch get unlimited contact (no free-call limit)"
            checked={premium}
            onChange={(e) => setPremium(e.target.checked)}
          />
          <AdminButton onClick={generate} loading={busy} style={{ width: "fit-content" }} icon={<Icon name="plus" size={16} strokeWidth={2.5} />}>
            {busy ? "Generating…" : "Generate QR batch"}
          </AdminButton>
        </div>
        {result ? <StatusText tone="success">{result.tags.length} tags created in {result.batch}.</StatusText> : null}
      </AdminCard>

      <AdminCard
        title="Generated batch"
        badge={result ? <Pill tone={result.premium ? "premium" : "free"}>{result.premium ? "Premium" : "Free"}</Pill> : null}
        actions={result ? <AdminButton variant="secondary" onClick={() => onNavigate("print-queue")}>Send to print queue</AdminButton> : null}
      >
        {result ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "var(--space-10)" }}>
            {result.tags.map((t) => (
              <div key={t.id} style={{ border: "1px solid var(--border-admin)", borderRadius: "var(--radius-md)", padding: "10px 12px", background: "var(--pt-gray-50)" }}>
                <p style={{ margin: "0 0 3px", fontFamily: "var(--font-plate)", fontSize: "var(--text-sm-plus)", fontWeight: "var(--weight-bold)" }}>{t.id}</p>
                <p style={{ margin: 0, fontSize: "var(--text-2xs)", color: "var(--text-admin-muted)" }}>{t.url}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No batch generated yet.</EmptyState>
        )}
      </AdminCard>
    </>
  );
}
