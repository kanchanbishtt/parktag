interface Props {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  from?: "bottom" | "left" | "right";
}

// A CSS scroll reveal, so it is server markup with nothing to hydrate: the
// content is in the HTML at full opacity and the animation only exists in
// browsers that support scroll timelines (see .pt-reveal in globals.css).
// Everywhere else, and with reduced motion or JS off, the block is simply
// visible. Never wrap above-the-fold content in this.
//
// `delay` used to be a transition delay in ms. A scroll-driven animation has no
// clock to delay, so it now nudges where in the entry range the reveal starts,
// which keeps side-by-side cards staggered.
export function AnimateIn({ children, className = "", delay = 0, from = "bottom" }: Props) {
  return (
    <div
      className={`pt-reveal pt-reveal-${from} ${className}`}
      style={{ "--pt-d": `${delay / 20}%` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
