import * as React from "react";

export interface StepStripProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Two to three short labels — "Scan", "Activate", "Done". */
  steps: string[];
  /** Zero-based index of the current step. */
  active?: number;
}

export declare function StepStrip(props: StepStripProps): JSX.Element;
