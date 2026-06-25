"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  from?: "bottom" | "left" | "right";
}

export function AnimateIn({ children, className = "", delay = 0, from = "bottom" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let observer: IntersectionObserver;
    let fallback: ReturnType<typeof setTimeout>;

    const show = () => {
      setVisible(true);
      observer?.disconnect();
      clearTimeout(fallback);
    };

    // After layout is painted, check position
    const raf = requestAnimationFrame(() => {
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // Already above viewport OR currently visible → show immediately (no waiting)
      if (rect.bottom <= 0 || rect.top < window.innerHeight) {
        show();
        return;
      }

      observer = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) show(); },
        { threshold: 0.08 }
      );
      observer.observe(el);

      // Safety net: show after 1.2s no matter what
      fallback = setTimeout(show, 1200);
    });

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  const translate = {
    bottom: "translateY(28px)",
    left: "translateX(-24px)",
    right: "translateX(24px)",
  }[from];

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translate(0)" : translate,
        transition: `opacity 550ms ease ${delay}ms, transform 550ms ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}
