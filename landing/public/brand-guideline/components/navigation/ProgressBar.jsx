import React from "react";

export function ProgressBar({ value = 40, done = false, style, ...rest }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: 3,
        width: done ? "100%" : `${value}%`,
        opacity: done ? 0 : 1,
        background: "var(--accent)",
        boxShadow: "0 0 8px rgba(255, 39, 0, 0.6)",
        borderRadius: "0 2px 2px 0",
        transition: "width var(--duration-bar) ease, opacity 400ms ease",
        zIndex: 9999,
        pointerEvents: "none",
        ...style,
      }}
      {...rest}
    />
  );
}
