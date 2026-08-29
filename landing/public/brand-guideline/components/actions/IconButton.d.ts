import * as React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** onDark — white glyph on the navy header · quiet — muted glyph on white · chip — grey square (modal close). */
  tone?: "onDark" | "quiet" | "chip";
  /** Required accessible label; these buttons have no text. */
  label: string;
}

export declare function IconButton(props: IconButtonProps): JSX.Element;
