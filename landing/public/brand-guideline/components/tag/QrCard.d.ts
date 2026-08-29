import * as React from "react";

export interface QrCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Generated QR image. Omit to show the 180x180 dashed placeholder. */
  qrSrc?: string;
  /** Caption under the code. Default "Scan to contact owner". */
  hint?: React.ReactNode;
  /** Optional left/right header row above the code. */
  header?: React.ReactNode;
}

export declare function QrCard(props: QrCardProps): JSX.Element;
