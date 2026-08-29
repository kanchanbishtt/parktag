import * as React from "react";

export interface MenuDrawerProps extends React.HTMLAttributes<HTMLElement> {
  open?: boolean;
  /** Owner name, 1rem / 800. */
  name?: React.ReactNode;
  /** Owner email, 0.8rem muted. */
  email?: React.ReactNode;
  onClose?: () => void;
}

export interface MenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  /** danger paints the label #DC2626 (Sign out). */
  tone?: "default" | "danger";
  active?: boolean;
}

export declare function MenuDrawer(props: MenuDrawerProps): JSX.Element | null;
export declare function MenuItem(props: MenuItemProps): JSX.Element;
