"use client";
import { useEffect } from "react";

export function GetStartedButton({ href }: { href: string }) {
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        document.body.style.transition = "";
        document.body.style.opacity = "1";
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  return (
    <a
      href={href}
      className="bg-[#1A9D20] hover:bg-[#158018] text-white font-bold px-7 py-3.5 rounded-xl text-base transition-colors"
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
