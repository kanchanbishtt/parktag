"use client";

import { useEffect, useRef } from "react";

// Tap a picture marked `data-zoom` to see it at full size.
//
// The chat screenshots carry the complaint as text inside the image, at a size
// nobody can read in a 250px card, so visitors tapped them and nothing
// happened. One <dialog> for the whole page, listening on the document, so the
// pictures themselves stay plain server-rendered <img> tags. The browser
// supplies the backdrop, Escape, and focus coming back; any tap closes it.
export function ImageZoom() {
  const dialog = useRef<HTMLDialogElement>(null);
  const big = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const shot = target?.closest?.("img[data-zoom]") as HTMLImageElement | null;
      if (!shot || !dialog.current || !big.current) return;
      big.current.src = shot.currentSrc || shot.src;
      big.current.alt = shot.alt;
      dialog.current.showModal();
    };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label="Enlarged photo"
      onClick={() => dialog.current?.close()}
      // Emptied on close, or the next photo opens showing this one until it loads.
      onClose={() => big.current?.removeAttribute("src")}
      className="m-auto max-h-[96dvh] max-w-[96vw] cursor-zoom-out border-0 bg-transparent p-0 backdrop:bg-[#03162D]/85"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={big} alt="" className="block h-auto max-h-[92dvh] w-auto max-w-[96vw] rounded-xl" />
    </dialog>
  );
}
