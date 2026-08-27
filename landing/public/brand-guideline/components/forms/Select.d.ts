import * as React from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** owner — 10px radius · admin — 8px radius, tighter padding. */
  surface?: "owner" | "admin";
}

export declare function Select(props: SelectProps): JSX.Element;
