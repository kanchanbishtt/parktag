import React from "react";

export function SuccessCheck({ size = 64, style, ...rest }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--accent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        margin: "0 auto",
        boxShadow: "0 4px 16px rgba(255, 39, 0, 0.3)",
        ...style,
      }}
      {...rest}
    >
      <svg width={size / 2} height={size / 2} viewBox="0 0 24 24" fill="none">
        <path d="M5 12l4 4L19 7" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
