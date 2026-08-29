import * as React from "react";

export type IconName =
  | "grid" | "tag" | "qr" | "printer" | "users" | "activity" | "shield"
  | "chevronRight" | "plus" | "menu" | "close" | "share" | "download"
  | "bell" | "login" | "logout" | "check" | "user" | "alert";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  /** Glyph key. Only names in PT_ICONS exist — do not invent new ones. */
  name: IconName;
  /** Rendered box in px. 16 in nav/admin, 18-22 in owner UI. */
  size?: number;
  /** Stroke width. Keep 2 — ParkTag icons are uniformly 2px. */
  strokeWidth?: number;
}

export declare const PT_ICONS: Record<IconName, string>;
export declare function Icon(props: IconProps): JSX.Element;
