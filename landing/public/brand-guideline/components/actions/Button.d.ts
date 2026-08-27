import * as React from "react";

/**
 * @startingPoint section="Actions" subtitle="Owner + scanner action buttons" viewport="700x200"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary  — red, the tag-facing call to action
   * activate — near-black #323232, the "commit" button on forms (login, activate, generate)
   * whatsapp — brand-green gradient, WhatsApp channel only
   * call     — navy gradient, masked-call channel only
   * outline  — white with a 1.5px hairline, secondary choices
   */
  variant?: "primary" | "activate" | "whatsapp" | "call" | "outline";
  /** Stretch to the container width. Default false. */
  full?: boolean;
  /** Swap the label for the 18px spinner and block input. */
  loading?: boolean;
  /** Leading glyph — pass an <Icon /> element. */
  icon?: React.ReactNode;
  /** Small second line under the label (used on the contact buttons). */
  sub?: React.ReactNode;
  /** Render as an anchor for link actions. */
  as?: "button" | "a";
}

export declare function Button(props: ButtonProps): JSX.Element;
