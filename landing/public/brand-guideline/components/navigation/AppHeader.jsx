import React from "react";

export function AppHeader({
  logoSrc = "../../assets/logo/parktag-logo-dark-bg.png",
  logoHeight = 42,
  align = "center",
  left = null,
  right = null,
  style,
  ...rest
}) {
  return (
    <header
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        height: "var(--header-height)",
        padding: "0 var(--space-16)",
        background: "var(--surface-chrome)",
        boxShadow: "var(--shadow-chrome)",
        ...style,
      }}
      {...rest}
    >
      {left}
      <span
        style={
          align === "center"
            ? { position: "absolute", left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center" }
            : { display: "inline-flex", alignItems: "center", marginLeft: left ? "var(--space-12)" : 0 }
        }
      >
        <img src={logoSrc} alt="ParkTag" style={{ height: logoHeight, width: "auto", mixBlendMode: "lighten" }} />
      </span>
      {right ? <span style={{ marginLeft: "auto" }}>{right}</span> : null}
    </header>
  );
}
