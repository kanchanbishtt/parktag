import * as React from "react";

/**
 * @startingPoint section="Chrome" subtitle="Navy app header with centred logo" viewport="700x80"
 */
export interface AppHeaderProps extends React.HTMLAttributes<HTMLElement> {
  /** Path to the light-on-dark logo (assets/logo/parktag-logo-dark-bg.png). */
  logoSrc?: string;
  /** Rendered logo height in px. 42 in owner views, 26 in dense chrome. */
  logoHeight?: number;
  /** center — owner dashboard · left — hub and auth pages. */
  align?: "center" | "left";
  /** Leading control, usually an <IconButton tone="onDark" />. */
  left?: React.ReactNode;
  /** Trailing element, usually a <Badge />. */
  right?: React.ReactNode;
}

export declare function AppHeader(props: AppHeaderProps): JSX.Element;
