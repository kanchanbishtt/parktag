import * as React from "react";

/**
 * @startingPoint section="Tag" subtitle="Vehicle number plate treatments" viewport="700x120"
 */
export interface PlateDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** solid — white Courier on the navy gradient (identity) · dashed — grey pending/preview state. */
  variant?: "solid" | "dashed";
  /** sm shrinks the solid plate for narrow phones (<400px). */
  size?: "sm" | "md";
}

export declare function PlateDisplay(props: PlateDisplayProps): JSX.Element;
