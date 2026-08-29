import React from "react";

export function PlateDisplay({ variant = "solid", size = "md", children, style, ...rest }) {
  const solid = variant === "solid";
  const fontSize = size === "sm" ? "1.25rem" : solid ? "var(--text-2xl-plus)" : "var(--text-3xl)";
  return (
    <span
      style={{
        fontFamily: "var(--font-plate)",
        fontWeight: solid ? "var(--weight-black)" : "var(--weight-heavy)",
        fontSize,
        letterSpacing: solid ? "var(--tracking-plate)" : "0.15em",
        textTransform: "uppercase",
        ...(solid
          ? {
              display: "inline-block",
              color: "#FFFFFF",
              background: "var(--pt-gradient-plate)",
              borderRadius: "var(--radius-md)",
              padding: size === "sm" ? "7px 12px" : "8px 16px",
              border: "1.5px solid rgba(255,255,255,0.12)",
              boxShadow: "var(--shadow-plate)",
              textShadow: "0 1px 3px rgba(0,0,0,0.4)",
            }
          : {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 20px",
              background: "var(--pt-gray-100)",
              borderRadius: "var(--radius-lg)",
              color: "var(--text-strong)",
              border: "2px dashed var(--border-default)",
            }),
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
