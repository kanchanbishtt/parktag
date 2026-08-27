import React from "react";

export function StepStrip({ steps = [], active = 0, style, ...rest }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: "var(--space-8)", ...style }} {...rest}>
      {steps.map((label, i) => {
        const on = i === active;
        return (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--space-8)",
              padding: "10px 12px",
              borderRadius: "var(--radius-3xl)",
              background: on ? "rgba(255, 39, 0, 0.14)" : "rgba(255, 255, 255, 0.72)",
              border: `1px solid ${on ? "rgba(255, 39, 0, 0.3)" : "rgba(0, 25, 53, 0.08)"}`,
              color: on ? "var(--accent-ink)" : "var(--text-muted)",
              fontSize: "var(--text-sm-plus)",
              fontWeight: "var(--weight-bold)",
            }}
          >
            <span style={{ display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "var(--radius-pill)", background: "rgba(255,255,255,0.92)", border: "1px solid rgba(0,25,53,0.12)", fontSize: "var(--text-xs-plus)", fontWeight: "var(--weight-heavy)" }}>{i + 1}</span>
            {label}
          </div>
        );
      })}
    </div>
  );
}
