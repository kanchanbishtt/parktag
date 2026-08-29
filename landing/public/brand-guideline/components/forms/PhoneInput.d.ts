import * as React from "react";

export interface PhoneInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Dial code shown in the fixed grey prefix. Default "+91" — ParkTag is India-first. */
  prefix?: string;
}

export declare function PhoneInput(props: PhoneInputProps): JSX.Element;
