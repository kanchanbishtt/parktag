"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

import { BuyOnAmazonButton } from "./BuyOnAmazonButton";

// Buy buttons point at /shop, which is the public storefront: packs, prices
// and a guest checkout, no login. It used to be an intent route that sent a
// signed-out visitor to /owner-login before a single price was visible
// (docs/SHOP_LOGIN_WALL.md); the storefront built to fix that lived at /get
// and nothing linked to it. It now lives at /shop, and /get redirects there.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

// Two dropdowns, not three.
//
// "More" was a junk drawer holding How it works, Pricing, Features and FAQ —
// the four pages a stranger most needs — behind the vaguest label in the menu.
// How It Works and Pricing are now top-level links, because a label nobody
// clicks is the same as a page nobody reads.
//
// "About" is folded into Support. About Us and Contact are both "I have a
// question about the company", and a dropdown holding two items is a dropdown
// paying for itself with one extra click.
const DROPDOWNS = {
  products: {
    label: "Products",
    items: [
      { label: "Solo Tag · ₹299", sub: "1 vehicle", href: `${APP_URL}/shop`, internal: false },
      { label: "Duo Pack · ₹499", sub: "1 car · front & back · saves ₹99", href: `${APP_URL}/shop`, internal: false },
      // Routes to the contact page rather than a mailto:, which does nothing at
      // all on a machine with no mail client configured.
      { label: "Fleet", sub: "5+ vehicles · custom pricing", href: "/contact", internal: true },
    ],
  },
  support: {
    label: "Support",
    items: [
      { label: "FAQ", sub: "Delivery, refunds, how it works", href: "#faq", internal: false },
      { label: "Contact", sub: "Talk to a person", href: "/contact", internal: true },
      { label: "About Us", sub: "Who builds ParkTag", href: "/about", internal: true },
    ],
  },
} as const;

type DropdownKey = keyof typeof DROPDOWNS;

export function SiteHeader({ defaultDark = true }: { defaultDark?: boolean }) {
  const [isDark, setIsDark] = useState(defaultDark);
  const [mounted, setMounted] = useState(false);
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

  // Set correct logo before first paint to avoid flash
  useLayoutEffect(() => {
    const NAV_H = 64;
    const firstDark = document.querySelector<HTMLElement>("[data-nav-dark]");
    const shouldBeDark = firstDark
      ? firstDark.getBoundingClientRect().bottom > NAV_H
      : defaultDark;
    setIsDark(shouldBeDark);
    prevDarkRef.current = shouldBeDark;
    setMounted(true);
  }, []);

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
  const textHover = isDark ? "#ffffff" : "#03162D";

  return (
    <>
      <header
        ref={headerRef}
        className="fixed top-0 left-0 right-0 z-50"
        style={{
          background: isDark ? "#03162D" : "#ffffff",
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
              style={{
                height: "42px", width: "auto", display: "block",
                opacity: mounted ? 1 : 0,
                transition: mounted ? "opacity 120ms ease" : "none",
              }}
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
                    style={{ color: isOpen ? "#FF2700" : textColor }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#FF2700"; openDropdown(key); }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = isOpen ? "#FF2700" : textColor; scheduleClose(); }}
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
                          <span className="text-sm font-medium text-[#03162D] group-hover:text-[#FF2700] transition-colors">{item.label}</span>
                          {"sub" in item && <span className="text-xs text-[#495B7B] group-hover:text-[#FF2700]/70 mt-0.5 transition-colors">{(item as {sub: string}).sub}</span>}
                        </Link>
                      ) : (
                        <a
                          key={item.label}
                          href={item.href}
                          onClick={closeAll}
                          className="flex flex-col px-4 py-2.5 hover:bg-gray-50 transition-colors group"
                        >
                          <span className="text-sm font-medium text-[#03162D] group-hover:text-[#FF2700] transition-colors">{item.label}</span>
                          {"sub" in item && <span className="text-xs text-[#495B7B] group-hover:text-[#FF2700]/70 mt-0.5 transition-colors">{(item as {sub: string}).sub}</span>}
                        </a>
                      )
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Out of the "More" drawer and into the open. These two answer
                "what is it" and "what does it cost", which is most of what a
                first-time visitor came to find out. */}
            {[
              { label: "How It Works", href: "#how-it-works" },
              { label: "Pricing", href: "#pricing" },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="px-3 py-2 text-sm rounded-lg transition-colors duration-200"
                style={{ color: textColor }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#FF2700")}
                onMouseLeave={(e) => (e.currentTarget.style.color = textColor)}
              >
                {label}
              </a>
            ))}

            {/* Login as nav link */}
            <a
              href={`${APP_URL}/owner-login`}
              onClick={navigateSmoothly(`${APP_URL}/owner-login`)}
              className="px-3 py-2 text-sm rounded-lg transition-colors duration-200"
              style={{ color: textColor }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FF2700")}
              onMouseLeave={(e) => (e.currentTarget.style.color = textColor)}
            >
              Login
            </a>

            {/* Title case. All caps on the least important item in the bar was
                shouting the quietest thing in it. */}
            <a
              href={`${APP_URL}/shop`}
              className="px-3 py-2 text-sm rounded-lg transition-colors duration-200"
              style={{ color: textColor }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#FF2700")}
              onMouseLeave={(e) => (e.currentTarget.style.color = textColor)}
            >
              Cart
            </a>

          </nav>

          {/* Desktop actions.
              The info icon and the flag are gone. The info icon linked to
              /about, which the Support menu already reaches, so the bar carried
              two paths to one page. The flag was a static SVG that looked
              exactly like a language selector and offered no languages —
              a control promising something it cannot do is worse than no
              control.
              What replaces them is the thing the bar never had: somewhere to
              buy. Every item in here weighed the same, and the one action the
              page exists for was not among them. */}
          <div className="hidden md:flex items-center gap-4">
            <BuyOnAmazonButton
              className="inline-flex items-center gap-1.5 text-sm transition-colors duration-200"
              style={{ color: textColor }}
            />
            <a
              href={`${APP_URL}/shop`}
              className="inline-flex items-center rounded-xl bg-[#FF2700] px-5 py-2.5 text-sm font-bold text-white transition-all duration-200 hover:bg-[#D92200] shadow-[0_4px_16px_rgba(255,39,0,0.35)] hover:shadow-[0_6px_20px_rgba(255,39,0,0.45)]"
            >
              Get ParkTag
            </a>
          </div>

          {/* Mobile right side */}
          <div className="flex md:hidden items-center gap-3">
            {!menuOpen && (
              <a
                href={`${APP_URL}/owner-login`}
                onClick={navigateSmoothly(`${APP_URL}/owner-login`)}
                className="bg-[#FF2700] hover:bg-[var(--red-hover)] text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors"
              >
                Login
              </a>
            )}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="w-9 h-9 flex flex-col items-center justify-center gap-[5px] rounded-lg"
              style={{ color: isDark ? "#ffffff" : "#03162D" }}
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
            {/* Same order as the desktop bar: buy, then understand, then ask.
                The drawer used to open on About Us, which is the page a
                first-time visitor needs least. */}
            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mb-2">Products</div>
            <a href={`${APP_URL}/shop`} onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">Solo Tag · ₹299</a>
            <a href={`${APP_URL}/shop`} onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">Duo Pack · ₹499</a>
            <Link href="/contact" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">Fleet · 5+ vehicles</Link>

            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mt-4 mb-2">Learn</div>
            <a href="#how-it-works" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">How It Works</a>
            <a href="#pricing" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">Pricing</a>

            <div className="text-[10px] font-bold text-[#495B7B]/40 tracking-widest uppercase mt-4 mb-2">Support</div>
            <a href="#faq" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">FAQ</a>
            <Link href="/contact" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">Contact</Link>
            <Link href="/about" onClick={closeAll} className="py-2.5 text-[#03162D] font-medium text-sm hover:text-[#FF2700] transition-colors">About Us</Link>

            <div className="mt-5 flex flex-col gap-3">
              <a href={`${APP_URL}/owner-login`} onClick={navigateSmoothly(`${APP_URL}/owner-login`)} className="text-center py-3 rounded-xl border-2 border-[#FF2700] text-[#FF2700] font-bold text-sm hover:bg-[#FF2700] hover:text-white transition-colors">Login</a>
              <a href={`${APP_URL}/shop`} onClick={closeAll} className="text-center py-3 rounded-xl bg-[#FF2700] text-white font-bold text-sm hover:bg-[var(--red-hover)] transition-colors">Get ParkTag</a>
              {/* Alternative buy paths, ranked below Order Now on purpose: the
                  shop is ours and is the only route where we see the purchase. */}
              <BuyOnAmazonButton className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-gray-300 text-[#495B7B] font-semibold text-sm hover:border-[#03162D] hover:text-[#03162D] transition-colors" />
            </div>
          </nav>
        </div>
      </div>
    </>
  );
}
