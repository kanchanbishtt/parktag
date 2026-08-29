import * as React from "react";

/**
 * @startingPoint section="Actions" subtitle="Admin console button set" viewport="700x140"
 */
export interface AdminButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary   — #323232 fill, the one committing action per card
   * secondary — grey fill with a hairline border
   * ghost     — grey fill, no border (sidebar utilities, tab-off state)
   * red       — destructive: red-50 fill, red text, red border
   */
  variant?: "primary" | "secondary" | "ghost" | "red";
  /** Stretch to container width (sidebar buttons). */
  full?: boolean;
  /** Dim and block input while a request is in flight. */
  loading?: boolean;
  /** Leading 15-16px <Icon />. */
  icon?: React.ReactNode;
}

export declare function AdminButton(props: AdminButtonProps): JSX.Element;
