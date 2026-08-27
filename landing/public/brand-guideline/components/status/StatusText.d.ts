import * as React from "react";

export interface StatusTextProps extends React.HTMLAttributes<HTMLParagraphElement> {
  /** info — muted navy · success — brand red · error — #DC2626 · adminInfo — grey. */
  tone?: "info" | "success" | "error" | "adminInfo";
  center?: boolean;
}

export declare function StatusText(props: StatusTextProps): JSX.Element;
