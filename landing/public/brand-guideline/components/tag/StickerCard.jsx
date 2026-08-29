import React from "react";

export function StickerCard({
  logoSrc = "../../assets/logo/parktag-logo-light-bg.png",
  variant = "premium",
  tagId,
  label = "E-Tag ID",
  children,
  style,
  ...rest
}) {
  const premium = variant === "premium";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: premium ? "var(--space-12)" : "var(--space-4)",
        alignItems: premium ? "stretch" : "center",
        padding: premium ? "18px" : "20px 28px",
        borderRadius: premium ? "var(--radius-5xl)" : "var(--radius-2xl)",
        background: premium ? "var(--pt-gradient-sticker)" : "var(--surface-card)",
        border: premium ? "1px solid var(--border-strong)" : "1px solid var(--border-default)",
        boxShadow: premium ? "var(--shadow-sticker)" : "0 4px 20px rgba(0,0,0,0.1), 0 1px 4px rgba(0,0,0,0.06)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-10)" }}>
        <img src={logoSrc} alt="ParkTag" style={{ height: 22, width: "auto", display: "block" }} />
      </div>
      {tagId ? (
        <div style={{ display: "grid", gap: "var(--space-6)" }}>
          <span style={{ fontSize: "var(--text-sm-plus)", fontWeight: "var(--weight-bold)", letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>
          <span style={{ fontFamily: "var(--font-plate)", fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)", letterSpacing: "0.04em", color: "var(--text-strong)" }}>{tagId}</span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
