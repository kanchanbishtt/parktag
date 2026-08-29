import * as React from "react";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** admin — 24px padding, #9CA3AF · owner — tighter, muted navy. */
  surface?: "admin" | "owner";
}

export declare function EmptyState(props: EmptyStateProps): JSX.Element;
