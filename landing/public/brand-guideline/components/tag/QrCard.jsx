import React from "react";

export function QrCard({ qrSrc, hint = "Scan to contact owner", header = null, children, style, ...rest }) {
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-2xl)",
        border: "1.5px solid var(--border-default)",
        padding: "var(--pad-card)",
        textAlign: "center",
        boxShadow: "var(--shadow-soft)",
        ...style,
      }}
      {...rest}
    >
      {header}
      {qrSrc ? (
        <img src={qrSrc} alt="ParkTag QR code" style={{ width: 180, height: 180, borderRadius: "var(--radius-sm)", display: "block", margin: "0 auto var(--space-8)" }} />
      ) : (
        <div style={{ width: 180, height: 180, margin: "0 auto var(--space-8)", borderRadius: "var(--radius-sm)", border: "2px dashed var(--border-default)", display: "grid", placeItems: "center", fontFamily: "var(--font-plate)", fontSize: "var(--text-xs)", color: "var(--text-admin-faint)", letterSpacing: "0.04em", textAlign: "center", lineHeight: 1.5 }}>
          QR CODE<br />180 × 180
        </div>
      )}
      {children}
      {hint ? <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{hint}</p> : null}
    </div>
  );
}
