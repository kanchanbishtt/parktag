import * as React from "react";

/**
 * @startingPoint section="Forms" subtitle="Text inputs across all three surfaces" viewport="700x180"
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * owner   — 10px radius, grey fill, turns white on focus (auth + dashboard)
   * scanner — 12px radius, white fill, 3px red focus ring (public scan/claim)
   * admin   — 8px radius, tighter padding, grey fill
   */
  surface?: "owner" | "scanner" | "admin";
  /** plate — Courier New, uppercase, tracked · code — large centred OTP style. */
  format?: "plate" | "code";
}

export declare function Input(props: InputProps): JSX.Element;
