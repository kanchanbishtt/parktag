import * as React from "react";

export interface GoogleButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export interface OrDividerProps {
  /** Divider text. Default "OR". */
  label?: string;
  style?: React.CSSProperties;
}

export declare function GoogleButton(props: GoogleButtonProps): JSX.Element;
export declare function OrDivider(props: OrDividerProps): JSX.Element;
