"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";

// The camera overlay is a separate chunk, fetched on first tap.
const ScanModal = dynamic(() => import("./ScanModal").then((m) => m.ScanModal));

// QR glyph: three finder squares plus a few data cells. Uses currentColor so it
// always matches the button label, and `shrink-0` so it can't squash when the
// hero column narrows.
function QrGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-[18px] h-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3z" />
      <path d="M20.5 14v.01M14 20.5v.01M20.5 20.5v.01" />
    </svg>
  );
}

export function ScanTagButton({
  appUrl,
  className,
  label = "Scan a Tag",
}: { appUrl: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  // Stable, because the modal keys its effects on it.
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "group inline-flex items-center gap-2.5 border border-[#FF2700] hover:bg-[#FF2700]/10 text-white font-semibold px-7 py-3.5 rounded-xl text-base transition-colors"}
      >
        <QrGlyph />
        {label}
      </button>
      {open && <ScanModal appUrl={appUrl} onClose={close} />}
    </>
  );
}
