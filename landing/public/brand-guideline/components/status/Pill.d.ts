import * as React from "react";

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Table-cell states from the E-Tags list. */
  tone?: "active" | "inactive" | "premium" | "free" | "deleted";
}

export declare function Pill(props: PillProps): JSX.Element;
