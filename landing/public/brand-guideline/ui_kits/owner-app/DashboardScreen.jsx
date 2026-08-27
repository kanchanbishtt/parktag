import React from "react";
import { AppHeader } from "../../components/navigation/AppHeader.jsx";
import { IconButton } from "../../components/actions/IconButton.jsx";
import { MenuDrawer, MenuItem } from "../../components/navigation/MenuDrawer.jsx";
import { Badge } from "../../components/status/Badge.jsx";
import { Icon } from "../../components/icons/Icon.jsx";
import { SuccessCheck } from "../../components/tag/SuccessCheck.jsx";
import { QrCard } from "../../components/tag/QrCard.jsx";
import { PlateDisplay } from "../../components/tag/PlateDisplay.jsx";
import { Card } from "../../components/data/Card.jsx";
import { DetailRow } from "../../components/data/DetailRow.jsx";
import { IconTile } from "../../components/tag/IconTile.jsx";
import { Field } from "../../components/forms/Field.jsx";
import { Select } from "../../components/forms/Select.jsx";
import { Button } from "../../components/actions/Button.jsx";
import { StatusText } from "../../components/status/StatusText.jsx";
import { NoticeBanner } from "../../components/status/NoticeBanner.jsx";
import { BottomBar } from "../../components/navigation/BottomBar.jsx";
import { Pill } from "../../components/status/Pill.jsx";
import { OWNER, TAG, OWNER_REQUESTS, NEXT_STEPS } from "./data.js";

const SECTION_LABEL = {
  margin: "0 0 14px",
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-heavy)",
  textTransform: "uppercase",
  letterSpacing: "var(--tracking-label)",
  color: "var(--text-muted)",
};

export function DashboardScreen({ onSignOut }) {
  const [menu, setMenu] = React.useState(false);
  const [active, setActive] = React.useState(true);

  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)", paddingBottom: 80 }}>
      <AppHeader
        left={<IconButton tone="onDark" label="Menu" onClick={() => setMenu(true)}><Icon name="menu" size={20} /></IconButton>}
        right={active ? <Badge tone="active" icon={<Icon name="shield" size={13} />}>Active</Badge> : <Badge tone="gray">Inactive</Badge>}
      />

      <MenuDrawer open={menu} name={OWNER.name} email={OWNER.email} onClose={() => setMenu(false)}>
        <MenuItem active icon={<Icon name="grid" size={18} />}>Dashboard</MenuItem>
        <MenuItem tone="danger" icon={<Icon name="logout" size={18} />} onClick={onSignOut}>Sign out</MenuItem>
      </MenuDrawer>

      <main style={{ maxWidth: "var(--width-owner)", margin: "0 auto", padding: "0 var(--space-16) var(--space-24)", display: "grid", gap: "var(--space-12)" }}>
        <div style={{ textAlign: "center", padding: "28px 0 20px" }}>
          <SuccessCheck />
          <h1 style={{ margin: "16px 0 8px", fontFamily: "var(--font-display)", fontSize: "var(--text-4xl)", fontWeight: "var(--weight-black)", lineHeight: "var(--leading-title)", color: "var(--text-strong)" }}>Tag Activated</h1>
          <p style={{ margin: 0, fontSize: "var(--text-md)", lineHeight: "var(--leading-body)", color: "var(--text-muted)" }}>
            Your ParkTag is now active and ready to help keep you connected and safe.
          </p>
        </div>

        <QrCard hint="Scan to contact owner" />

        <Card tone="soft" style={{ margin: 0 }}>
          <h3 style={SECTION_LABEL}>Your Vehicle Details</h3>
          <div style={{ display: "grid", gap: 6, justifyItems: "center", marginBottom: 10 }}>
            <PlateDisplay>{TAG.plate}</PlateDisplay>
          </div>
          <DetailRow label="Vehicle" value={TAG.model} />
          <DetailRow label="Type" value={TAG.type} />
          <DetailRow label="E-Tag ID" value={TAG.id} mono />
          <DetailRow label="Plan" value={<Pill tone="premium">{TAG.plan}</Pill>} last />
        </Card>

        <Card tone="soft" style={{ margin: 0 }}>
          <h3 style={SECTION_LABEL}>Tag Controls</h3>
          <Field label="Select tag" style={{ marginBottom: 12 }}>
            <Select><option>{TAG.plate} · {TAG.id}</option></Select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Button variant="activate" onClick={() => setActive(true)} style={{ fontSize: "0.88rem", padding: 11, opacity: active ? 1 : 0.85 }}>Set Active</Button>
            <Button variant="outline" onClick={() => setActive(false)} style={{ fontSize: "0.88rem", padding: 11 }}>Set Inactive</Button>
          </div>
          <StatusText tone={active ? "success" : "info"} center>
            {active ? "Tag is live — scans reach you." : "Tag is paused — scanners see an unavailable notice."}
          </StatusText>
        </Card>

        <Card tone="soft" style={{ margin: 0 }}>
          <h3 style={SECTION_LABEL}>What's Next?</h3>
          <div style={{ display: "grid", gap: 14 }}>
            {NEXT_STEPS.map((s) => (
              <div key={s.title} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <IconTile size="sm" tone={s.tone}><Icon name={s.icon} size={16} /></IconTile>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: "0 0 2px", fontSize: "var(--text-base-plus)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)" }}>{s.title}</p>
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: "var(--leading-snug)", color: "var(--text-muted)" }}>{s.sub}</p>
                </div>
                <span style={{ color: "var(--text-muted)" }}><Icon name="chevronRight" size={16} /></span>
              </div>
            ))}
          </div>
        </Card>

        <Card tone="soft" style={{ margin: 0 }}>
          <h3 style={SECTION_LABEL}>Recent Contact Requests</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {OWNER_REQUESTS.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 10, borderBottom: i === OWNER_REQUESTS.length - 1 ? "none" : "1px solid var(--border-default)" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: "0 0 2px", fontSize: "var(--text-base-plus)", fontWeight: "var(--weight-bold)", color: "var(--text-strong)" }}>{r.reason}</p>
                  <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{r.channel} · {r.when}</p>
                </div>
                <span style={{ marginLeft: "auto" }}><Pill tone="active">{r.state}</Pill></span>
              </div>
            ))}
          </div>
        </Card>

        <NoticeBanner icon={<Icon name="bell" size={18} />}>
          In an emergency, others can scan your tag to contact you quickly and securely.
        </NoticeBanner>
      </main>

      <BottomBar><Button variant="activate" full>Done</Button></BottomBar>
    </div>
  );
}
