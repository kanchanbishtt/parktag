import React from "react";

export function Skeleton({ height = 14, width = "100%", radius = "var(--radius-sm)", style, ...rest }) {
  return (
    <span
      style={{
        display: "block",
        height,
        width,
        borderRadius: radius,
        background: "linear-gradient(90deg, #EEEEEE 25%, #E2E2E2 37%, #EEEEEE 63%)",
        backgroundSize: "600px 100%",
        animation: "pt-shimmer var(--duration-shimmer) ease infinite",
        ...style,
      }}
      {...rest}
    />
  );
}
