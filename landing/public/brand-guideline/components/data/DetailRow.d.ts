import * as React from "react";

export interface DetailRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  /** Optional 16px leading <Icon />. */
  icon?: React.ReactNode;
  value: React.ReactNode;
  /** Courier New value — tag IDs, tokens. */
  mono?: boolean;
  /** Widen tracking — vehicle numbers. */
  tracked?: boolean;
  /** Drop the bottom hairline on the final row. */
  last?: boolean;
}

export declare function DetailRow(props: DetailRowProps): JSX.Element;
