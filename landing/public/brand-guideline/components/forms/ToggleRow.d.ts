import * as React from "react";

/**
 * @startingPoint section="Forms" subtitle="Explained switch row (premium access)" viewport="700x120"
 */
export interface ToggleRowProps {
  /** Bold 0.85rem title. */
  title: React.ReactNode;
  /** Grey 0.75rem explanation of what turning it on does. */
  description?: React.ReactNode;
  checked?: boolean;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
}

export declare function ToggleRow(props: ToggleRowProps): JSX.Element;
