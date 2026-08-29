import React from "react";

export function BottomBar({ maxWidth = "var(--width-owner)", children, style, ...rest }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "var(--space-12) var(--space-16)",
        background: "var(--surface-card)",
        borderTop: "1px solid var(--border-default)",
        boxShadow: "var(--shadow-bottom-bar)",
        maxWidth,
        margin: "0 auto",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
