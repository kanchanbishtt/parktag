import * as React from "react";

export interface ProgressBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 0-100 fill percentage. */
  value?: number;
  /** Snap to 100% and fade out. */
  done?: boolean;
}

export declare function ProgressBar(props: ProgressBarProps): JSX.Element;
