import * as React from "react";

/**
 * @startingPoint section="Surfaces" subtitle="Owner-facing card, three elevations" viewport="700x260"
 */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * default — 20px radius, deep two-layer navy shadow (auth, scan cards)
   * soft    — 16px radius, 1.5px border, light shadow (dashboard sections)
   * premium — 26px radius, 18/42 lift (activation flow)
   */
  tone?: "default" | "soft" | "premium";
  title?: React.ReactNode;
  sub?: React.ReactNode;
  /** Usually an <IconTile />. */
  icon?: React.ReactNode;
}

export declare function Card(props: CardProps): JSX.Element;
