import * as React from "react";

export interface BottomBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Column width it centres within. Default 420px (owner dashboard). */
  maxWidth?: string | number;
}

export declare function BottomBar(props: BottomBarProps): JSX.Element;
