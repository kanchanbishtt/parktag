import * as React from "react";

export interface AdminNavItem {
  id: string;
  label: string;
  href?: string;
  /** 16px <Icon />. */
  icon?: React.ReactNode;
}

export interface AdminNavSection {
  /** Uppercase group caption, e.g. "Management" / "Monitoring". */
  label: string;
  items: AdminNavItem[];
}

/**
 * @startingPoint section="Chrome" subtitle="240px admin console sidebar" viewport="700x420"
 */
export interface AdminSidebarProps extends React.HTMLAttributes<HTMLElement> {
  logoSrc?: string;
  /** Role pill next to the logo. Default "Admin". */
  role?: string;
  sections: AdminNavSection[];
  /** id of the current item — gets the red-tint active treatment. */
  active?: string;
  /** Intercept clicks for in-page routing. */
  onNavigate?: (id: string) => void;
  /** Bottom utilities, e.g. Refresh + Sign out AdminButtons. */
  footer?: React.ReactNode;
}

export declare function AdminSidebar(props: AdminSidebarProps): JSX.Element;
