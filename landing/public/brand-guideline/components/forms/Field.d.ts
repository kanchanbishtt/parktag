import * as React from "react";

export interface FieldProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Sentence-case label. ParkTag never uppercases field labels. */
  label: React.ReactNode;
  /** Optional helper line under the control. */
  hint?: React.ReactNode;
  /** owner — navy 0.88rem label · admin — grey 0.82rem label. */
  surface?: "owner" | "admin";
  /** Span both columns in a 2-up admin form row. */
  wide?: boolean;
}

export declare function Field(props: FieldProps): JSX.Element;
