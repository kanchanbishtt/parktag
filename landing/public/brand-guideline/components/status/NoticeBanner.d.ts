import * as React from "react";

export interface NoticeBannerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 18px <Icon /> — usually "bell" or "shield". */
  icon?: React.ReactNode;
}

export declare function NoticeBanner(props: NoticeBannerProps): JSX.Element;
