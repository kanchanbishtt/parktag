import * as React from "react";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Uppercase 0.75rem caption. */
  label: React.ReactNode;
  /** 2rem / 900 figure. Keep it a raw count — no deltas, no sparklines. */
  value: React.ReactNode;
}

export declare function StatCard(props: StatCardProps): JSX.Element;
