"use client";

// The page's one primary action. Label and styling are props now because the
// hero asks it to say "Buy now · ₹499" while other callers still want the
// plain "Get Started" — the fade-out navigation below is the part worth sharing,
// and duplicating it into a second component would mean two places to fix when
// the transition changes.
export function GetStartedButton({
  href,
  children = "Get Started",
  className = "bg-[#FF2700] hover:bg-[var(--red-hover)] text-white font-bold px-7 py-3.5 rounded-xl text-base transition-colors",
}: {
  href: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        document.body.style.transition = "opacity 180ms ease";
        document.body.style.opacity = "0";
        setTimeout(() => { window.location.href = href; }, 190);
      }}
    >
      {children}
    </a>
  );
}
