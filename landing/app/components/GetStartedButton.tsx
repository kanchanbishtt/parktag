// The page's one primary action. Label and styling are props because the hero
// asks it to say "Duo Pack · 2 tags · ₹499" while other callers still want the
// plain "Get Started".
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
    <a href={href} className={className}>
      {children}
    </a>
  );
}
