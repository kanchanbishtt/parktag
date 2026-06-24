"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

const DROPDOWNS = {
  about: {
    label: "About",
    items: [
      { label: "About Us", href: "/about", internal: true },
      { label: "Contact", href: "/contact", internal: true },
    ],
  },
  products: {
    label: "Products",
    items: [
      { label: "Solo Tag · ₹199", sub: "1 vehicle", href: `${APP_URL}/register-owner`, internal: false },
      { label: "Duo Pack · ₹349", sub: "2 vehicles · saves ₹49", href: `${APP_URL}/register-owner`, internal: false },
      { label: "Fleet", sub: "5+ vehicles · custom pricing", href: "mailto:support@parktag.me", internal: false },
    ],
  },
  more: {
    label: "More",
    items: [
      { label: "How it works", href: "#how-it-works", internal: false },
      { label: "Features", href: "#features", internal: false },
      { label: "Pricing", href: "#pricing", internal: false },
      { label: "FAQ", href: "#faq", internal: false },
    ],
  },
} as const;

type DropdownKey = keyof typeof DROPDOWNS;

export function SiteHeader({ defaultDark = true }: { defaultDark?: boolean }) {
  const [isDark, setIsDark] = useState(defaultDark);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<DropdownKey | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDarkRef = useRef(defaultDark);
  const slidingRef = useRef(false);

  const openDropdown = (key: DropdownKey) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setActiveDropdown(key);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setActiveDropdown(null), 120);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  useEffect(() => {
    const NAV_H = 64;

    function doSlide(newDark: boolean) {
      if (slidingRef.current) return;
      slidingRef.current = true;
      prevDarkRef.current = newDark;

      const el = headerRef.current;
      if (!el) { slidingRef.current = false; return; }

      // Phase 1 — fade + lift off (gentle, not a hard snap to edge)
      el.style.transition = "transform 220ms ease-in, opacity 160ms ease-in";
      el.style.transform = "translateY(-110%)";
      el.style.opacity = "0";

      const t1 = setTimeout(() => {
        // Swap colour while fully invisible
        setIsDark(newDark);

        // Reset position just below entry point, still invisible
        el.style.transition = "none";
        el.style.transform = "translateY(-110%)";
        el.style.opacity = "0";

        // Double rAF so React flushes the colour change before we animate in
        requestAnimationFrame(() => requestAnimationFrame(() => {
          // Phase 2 — smooth drop with spring + fade in
          el.style.transition =
            "transform 420ms cubic-bezier(0.16, 1, 0.3, 1), opacity 260ms ease-out";
          el.style.transform = "translateY(0)";
          el.style.opacity = "1";

          const t2 = setTimeout(() => {
            el.style.transition = "";
            el.style.transform = "";
            el.style.opacity = "";
            slidingRef.current = false;
          }, 420);
        }));
      }, 220);
    }

    function check() {
      // Only the FIRST data-nav-dark section (hero) controls the theme.
      // Subsequent dark sections (How it Works, CTA) are ignored.
      const firstDark = document.querySelector<HTMLElement>("[data-nav-dark]");
      const shouldBeDark = firstDark
        ? firstDark.getBoundingClientRect().bottom > NAV_H
        : defaultDark;
      if (shouldBeDark !== prevDarkRef.current && !slidingRef.current) {
        doSlide(shouldBeDark);
      }
    }

    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, [defaultDark]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const closeAll = () => { setMenuOpen(false); setActiveDropdown(null); };

  const navigateSmoothly = (href: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    closeAll();
    document.body.style.transition = "opacity 150ms ease";
    document.body.style.opacity = "0";
    setTimeout(() => { window.location.href = href; }, 160);
  };

  const textColor = isDark ? "rgba(255,255,255,0.65)" : "#495B7B";
  const textHover = isDark ? "#ffffff" : "#001935";

  return (
    <>
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: isDark ? "#001935" : "#ffffff",
          borderBottom: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid #e5e7eb",
          boxShadow: isDark ? "none" : "0 1px 6px rgba(0,0,0,0.06)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

          {/* Logo */}
          <Link href="/" className="flex-shrink-0" onClick={closeAll}>
            <img
              src={isDark ? "/dark-logo.png" : "/light-logo.png"}
              alt="ParkTag"
              style={{ height: "42px", width: "auto", display: "block" }}
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {(Object.keys(DROPDOWNS) as DropdownKey[]).map((key) => {
              const { label, items } = DROPDOWNS[key];
              const isOpen = activeDropdown === key;
              return (
                <div key={key} className="relative">
                  <button
                    className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg transition-colors duration-200"
                    style={{ color: isOpen ? "#1A9D20" : textColor }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#1A9D20"; openDropdown(key); }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = isOpen ? "#1A9D20" : textColor; scheduleClose(); }}
                    onClick={() => setActiveDropdown(isOpen ? null : key)}
                  >
                    {label}
                    <svg
                      width="12" height="12" viewBox="0 0 12 12" fill="none"
                      style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 200ms" }}
                    >
                      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>

                  {/* Dropdown panel */}
                  <div
                    className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-2 min-w-[200px] origin-top"
                    style={{
                      opacity: isOpen ? 1 : 0,
                      transform: isOpen ? "scale(1) translateY(0)" : "scale(0.97) translateY(-6px)",
                      pointerEvents: isOpen ? "auto" : "none",
                      transition: "opacity 200ms ease, transform 200ms ease",
                    }}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                  >
                    {"sub" in DROPDOWNS[key].items[0] && (
                      <div className="px-4 pb-1 pt-1 text-[10px] font-bold text-[#495B7B]/50 tracking-widest uppercase">
                        {key === "products" ? "India" : ""}
                      </div>
                    )}
                    {items.map((item) => (
                      item.internal ? (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={closeAll}
                          className="flex flex-col px-4 py-2.5 hover:bg-gray-50 transition-colors group"
                        >
                          <span className="text-sm font-medium text-[#001935] group-hover:text-[#1A9D20] transition-colors">{item.label}</span>
                          {"sub" in item && <span className="text-xs text-[#495B7B] group-hover:text-[#1A9D20]/70 mt-0.5 transition-colors">{(item as {sub: string}).sub}</span>}
                        </Link>
                      ) : (
                        <a
                          key={item.label}
                          href={item.href}
                          onClick={closeAll}
                          className="flex flex-col px-4 py-2.5 hover:bg-gray-50 transition-colors group"
                        >
                          <span className="text-sm font-medium text-[#001935] group-hover:text-[#1A9D20] transition-colors">{item.label}</span>
                          {"sub" in item && <span className="text-xs text-[#495B7B] group-hover:text-[#1A9D20]/70 mt-0.5 transition-colors">{(item as {sub: string}).sub}</span>}
                        </a>
                      )
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Login as nav link */}
            <a
              href={`${APP_URL}/owner-login`}
              onClick={navigateSmoothly(`${APP_URL}/owner-login`)}
              className="px-3 py-2 text-sm rounded-lg transition-colors duration-200"
              style={{ color: textColor }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#1A9D20")}
              onMouseLeave={(e) => (e.currentTarget.style.color = textColor)}
            >
              Login
            </a>

            {/* Cart — inside nav to match layout */}
            <a
              href={`${APP_URL}/register-owner`}
              className="px-3 py-2 text-sm rounded-lg transition-colors duration-200"
              style={{ color: textColor }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#1A9D20")}
              onMouseLeave={(e) => (e.currentTarget.style.color = textColor)}
            >
              CART
            </a>
          </nav>

          {/* Desktop actions — info + flag only */}
          <div className="hidden md:flex items-center gap-3">

            {/* Info button — SVG icon */}
            <Link
              href="/about"
              className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 flex-shrink-0"
              style={{
                color: textColor,
                border: `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "#d1d5db"}`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "#1A9D20";
                e.currentTarget.style.border = "1.5px solid #1A9D20";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = textColor;
                e.currentTarget.style.border = `1.5px solid ${isDark ? "rgba(255,255,255,0.18)" : "#d1d5db"}`;
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="4.5" r="1" fill="currentColor"/>
                <rect x="6.25" y="6.5" width="1.5" height="4" rx="0.75" fill="currentColor"/>
              </svg>
            </Link>

            {/* Indian flag — SVG, 3:2 ratio */}
            <svg
              width="28" height="19" viewBox="0 0 28 19" fill="none"
              style={{ borderRadius: "3px", flexShrink: 0, display: "block" }}
            >
              {/* Saffron */}
              <rect x="0" y="0"      width="28" height="6.33" fill="#FF9933"/>
              {/* White */}
              <rect x="0" y="6.33"  width="28" height="6.34" fill="#FFFFFF"/>
              {/* Green */}
              <rect x="0" y="12.67" width="28" height="6.33" fill="#138808"/>
              {/* Ashoka Chakra – circle */}
              <circle cx="14" cy="9.5" r="2.8" stroke="#000080" strokeWidth="0.7" fill="none"/>
              {/* 8 spokes */}
              {Array.from({ length: 8 }).map((_, i) => {
                const angle = (i * Math.PI) / 4;
                const x1 = 14 + Math.cos(angle) * 0.6;
                const y1 = 9.5 + Math.sin(angle) * 0.6;
                const x2 = 14 + Math.cos(angle) * 2.8;
                const y2 = 9.5 + Math.sin(angle) * 2.8;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#000080" strokeWidth="0.5"/>;
              })}
              <circle cx="14" cy="9.5" r="0.55" fill="#000080"/>
            </svg>

          </div>

          {/* Mobile right side */}
          <div className="flex md:hidden items-center gap-3">
            {!menuOpen && (
              <a
                href={`${APP_URL}/owner-login`}
                onClick={navigateSmoothly(`${APP_URL}/owner-login`)}
                className="bg-[#1A9D20] hover:bg-[#158018] text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Login
              </a>
            )}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="w-9 h-9 flex flex-col items-center justify-center gap-[5px] rounded-lg"
              style={{ color: isDark ? "#ffffff" : "#001935" }}
            >
              <span className="block h-[2px] w-5 rounded-full bg-current transition-all duration-300 origin-center"
                style={{ transform: menuOpen ? "translateY(7px) rotate(45deg)" : "none" }} />
              <span className="block h-[2px] w-5 rounded-full bg-current transition-all duration-300"
                style={{ opacity: menuOpen ? 0 : 1 }} />
              <span className="block h-[2px] w-5 rounded-full bg-current transition-all duration-300 origin-center"
                style={{ transform: menuOpen ? "translateY(-7px) rotate(-45deg)" : "none" }} />
            </button>
          </div>

        </div>
      </header>

      {/* Mobile drawer */}
      <div className="fixed inset-0 z-40 md:hidden" style={{ pointerEvents: menuOpen ? "auto" : "none" }}>
        <div
          className="absolute inset-0 bg-black/40 transition-opacity duration-300"
          style={{ opacity: menuOpen ? 1 : 0 }}
          onClick={closeAll}
        />
        <div
          className="absolute top-16 left-0 right-0 bg-white shadow-xl transition-all duration-300 overflow-y-auto"
          style={{ maxHeight: menuOpen ? "calc(100vh - 64px)" : "0px", opacity: menuOpen ? 1 : 0 }}
        >
          <nav className="px-5 pt-4 pb-6 flex flex-col">
            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mb-2">About</div>
            <Link href="/about" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">About Us</Link>
            <Link href="/contact" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Contact</Link>

            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mt-4 mb-2">Products</div>
            <a href={`${APP_URL}/register-owner`} onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Solo Tag · ₹199</a>
            <a href={`${APP_URL}/register-owner`} onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Duo Pack · ₹349</a>
            <a href="mailto:support@parktag.me" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Fleet</a>

            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mt-4 mb-2">More</div>
            <a href="#how-it-works" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">How it works</a>
            <a href="#features" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Features</a>
            <a href="#pricing" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">Pricing</a>
            <a href="#faq" onClick={closeAll} className="py-2.5 text-[#001935] font-medium text-sm hover:text-[#1A9D20] transition-colors">FAQ</a>

            <div className="mt-5 flex flex-col gap-3">
              <a href={`${APP_URL}/owner-login`} onClick={navigateSmoothly(`${APP_URL}/owner-login`)} className="text-center py-3 rounded-xl border-2 border-[#001935] text-[#001935] font-bold text-sm hover:bg-[#001935] hover:text-white transition-colors">Login</a>
              <a href={`${APP_URL}/register-owner`} onClick={closeAll} className="text-center py-3 rounded-xl bg-[#1A9D20] text-white font-bold text-sm hover:bg-[#158018] transition-colors">Order Now</a>
            </div>
          </nav>
        </div>
      </div>
    </>
  );
}
