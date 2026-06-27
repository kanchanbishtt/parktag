"use client";

export function GetStartedButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="bg-[#FF2700] hover:bg-[#D92200] text-white font-bold px-7 py-3.5 rounded-xl text-base transition-colors"
      onClick={(e) => {
        e.preventDefault();
        document.body.style.transition = "opacity 180ms ease";
        document.body.style.opacity = "0";
        setTimeout(() => { window.location.href = href; }, 190);
      }}
    >
      Get Started
    </a>
  );
}
