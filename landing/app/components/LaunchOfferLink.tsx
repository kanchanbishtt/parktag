"use client";

// The one interactive piece of the launch banner: a link that reports the
// promotion click. Everything else about the offer is server-rendered.
export function LaunchOfferLink({
  href,
  code,
  productId,
  className,
  children,
}: {
  href: string;
  code: string;
  productId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      // Never delays the navigation; ptTrack is a no-op until /pt-analytics.js loads.
      onClick={() => window.ptTrack?.("select_promotion", {
        promotion_id: code,
        promotion_name: "Launch offer",
        items: [{ item_id: productId }]
      })}
      className={className}>
      {children}
    </a>
  );
}
