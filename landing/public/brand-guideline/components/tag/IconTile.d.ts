import * as React from "react";

export interface IconTileProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** accent / soft / tag are red tints; error is the red-100 danger tint. */
  tone?: "accent" | "soft" | "tag" | "error";
  /** md — 48px, 14px radius (card headers) · sm — 34px, 8px radius (list rows). */
  size?: "md" | "sm";
}

export declare function IconTile(props: IconTileProps): JSX.Element;
