import * as React from "react";

export interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Inline label to the right of the box. */
  label: React.ReactNode;
}

export declare function Checkbox(props: CheckboxProps): JSX.Element;
