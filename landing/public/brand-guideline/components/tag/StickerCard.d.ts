import * as React from "react";

export interface StickerCardProps extends React.HTMLAttributes<HTMLDivElement> {
  logoSrc?: string;
  /** premium — 24px radius, white-to-grey gradient · plain — simple centred card. */
  variant?: "premium" | "plain";
  /** The printed tag's code, set in Courier New. */
  tagId?: React.ReactNode;
  /** Caption above the code. Default "E-Tag ID". */
  label?: React.ReactNode;
}

export declare function StickerCard(props: StickerCardProps): JSX.Element;
