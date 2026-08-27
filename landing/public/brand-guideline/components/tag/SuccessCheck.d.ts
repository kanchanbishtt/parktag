import * as React from "react";

export interface SuccessCheckProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Diameter in px. Default 64. */
  size?: number;
}

export declare function SuccessCheck(props: SuccessCheckProps): JSX.Element;
