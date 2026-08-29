import * as React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * active/amber — red tints, tag is live · red — attention/admin role
   * gray — neutral counts · verified — green, identity confirmed
   * glass/glassWarn/glassSuccess — translucent, for the navy header only
   */
  tone?: "active" | "amber" | "red" | "gray" | "admin" | "verified" | "glass" | "glassWarn" | "glassSuccess";
  /** Leading 13px <Icon />. */
  icon?: React.ReactNode;
}

export declare function Badge(props: BadgeProps): JSX.Element;
