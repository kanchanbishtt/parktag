import * as React from "react";

/**
 * @startingPoint section="Tag" subtitle="Why-are-you-scanning reason chips" viewport="700x160"
 */
export interface ReasonChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Locks the red-tint state after the scanner picks it. */
  selected?: boolean;
  /** Emergency reason: red border/tint and spans both grid columns. */
  alert?: boolean;
  icon?: React.ReactNode;
}

export declare function ReasonChip(props: ReasonChipProps): JSX.Element;
