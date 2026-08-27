import * as React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLSpanElement> {
  height?: number | string;
  width?: number | string;
  radius?: string;
}

export declare function Skeleton(props: SkeletonProps): JSX.Element;
