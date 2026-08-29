import React from "react";
import { StepStrip } from "../../components/navigation/StepStrip.jsx";
import { StickerCard } from "../../components/tag/StickerCard.jsx";
import { Card } from "../../components/data/Card.jsx";
import { Field } from "../../components/forms/Field.jsx";
import { Input } from "../../components/forms/Input.jsx";
import { PhoneInput } from "../../components/forms/PhoneInput.jsx";
import { Select } from "../../components/forms/Select.jsx";
import { Checkbox } from "../../components/forms/Checkbox.jsx";
import { Button } from "../../components/actions/Button.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { TAG } from "./data.js";

export function ActivateScreen({ onActivated }) {
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  function activate() {
    setBusy(true);
    setTimeout(() => { setBusy(false); onActivated(); }, 800);
  }

  return (
    <div style={{ minHeight: "100vh", padding: "18px 14px 42px", background: "var(--pt-gradient-activate)" }}>
      <div style={{ width: "min(460px, 100%)", margin: "0 auto", display: "grid", gap: "var(--space-16)" }}>
        <div style={{ display: "grid", gap: "var(--space-14)" }}>
          <div style={{ display: "grid", gap: "var(--space-10)" }}>
            <p style={{ margin: 0, color: "var(--accent)", fontSize: "var(--text-sm-plus)", fontWeight: "var(--weight-heavy)", letterSpacing: "var(--tracking-eyebrow)", textTransform: "uppercase" }}>Activate your tag</p>
            <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-display)", fontWeight: "var(--weight-black)", lineHeight: 0.94, letterSpacing: "var(--tracking-tightest)", color: "var(--text-strong)" }}>
              Link this sticker to your vehicle.
            </h1>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-lg)", lineHeight: "var(--leading-loose)", maxWidth: "34ch" }}>
              Two minutes, then anyone who scans it can reach you — without ever seeing your number.
            </p>
          </div>
          <StickerCard tagId={TAG.id} />
          <StepStrip steps={["Scan tag", "Add vehicle", "Activate"]} active={1} />
        </div>

        <Card tone="premium" style={{ margin: 0 }}>
          <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--text-2xl-plus)", fontWeight: "var(--weight-heavy)", lineHeight: "var(--leading-display)", letterSpacing: "var(--tracking-tighter)", color: "var(--text-strong)" }}>Your details</h2>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "var(--text-md)", lineHeight: "var(--leading-body)" }}>Only your name is ever shown to a scanner. Never your number.</p>
          </div>

          <div style={{ display: "grid", gap: "var(--space-20)" }}>
            <div style={{ display: "grid", gap: "var(--space-14)" }}>
              <p style={{ margin: 0, color: "var(--accent-ink)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-heavy)", letterSpacing: "var(--tracking-eyebrow-wide)", textTransform: "uppercase" }}>Owner details</p>
              <Field label="Full name"><Input placeholder="Rohit Sharma" /></Field>
              <Field label="Email address"><Input type="email" placeholder="you@example.com" /></Field>
              <Field label="Mobile number"><PhoneInput placeholder="98765 43210" /></Field>
            </div>

            <div style={{ display: "grid", gap: "var(--space-14)" }}>
              <p style={{ margin: 0, color: "var(--accent-ink)", fontSize: "var(--text-sm)", fontWeight: "var(--weight-heavy)", letterSpacing: "var(--tracking-eyebrow-wide)", textTransform: "uppercase" }}>Vehicle details</p>
              <Field label="Vehicle number"><Input format="plate" placeholder="DL 8C AB 1234" /></Field>
              <Field label="Vehicle type">
                <Select>
                  <option>Hatchback</option>
                  <option>Sedan</option>
                  <option>SUV</option>
                  <option>Two-wheeler</option>
                </Select>
              </Field>
              <Field label="Make &amp; colour" hint="Optional — helps a scanner confirm they have the right vehicle.">
                <Input placeholder="Maruti Swift · White" />
              </Field>
            </div>

            <div style={{ padding: "14px 14px 14px 12px", borderRadius: "var(--radius-3xl)", background: "rgba(255, 39, 0, 0.08)", border: "1px solid rgba(255, 39, 0, 0.16)" }}>
              <Checkbox label="I agree to ParkTag contacting me on this number when someone scans my tag." checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            </div>

            <Button variant="activate" full loading={busy} disabled={!consent} onClick={activate} style={{ minHeight: 54, borderRadius: "var(--radius-3xl)", fontWeight: "var(--weight-heavy)", boxShadow: "0 14px 30px rgba(0, 25, 53, 0.18)" }}>
              Activate my tag
            </Button>

            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "14px 15px", borderRadius: "var(--radius-3xl)", background: "rgba(255,255,255,0.72)", border: "1px solid rgba(111,104,95,0.12)", color: "var(--text-muted)", fontSize: "0.92rem", lineHeight: 1.55 }}>
              <span style={{ color: "var(--accent)" }}><Icon name="shield" size={18} /></span>
              Your number is stored encrypted and never shown to whoever scans the tag — calls are masked and messages route through WhatsApp.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
