import * as React from "react";

/**
 * @startingPoint section="Surfaces" subtitle="Admin console content card" viewport="700x200"
 */
export interface AdminCardProps extends React.HTMLAttributes<HTMLElement> {
  title?: React.ReactNode;
  /** One-line explanation under the title. */
  sub?: React.ReactNode;
  /** Right-aligned buttons in the header. */
  actions?: React.ReactNode;
  /** Small count <Badge /> shown inline after the title. */
  badge?: React.ReactNode;
}

export declare function AdminCard(props: AdminCardProps): JSX.Element;
