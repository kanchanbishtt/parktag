"use client";

import { useEffect, useRef } from "react";

// A muted looping clip that costs nothing until it is about to be seen.
// `preload="none"` alone is not enough here, because autoPlay would fetch the
// whole MP4 at load even when it is thousands of pixels below the fold. So
// there is no autoPlay; play() is called once the element is near the viewport,
// and the poster covers the gap.
export function LazyVideo({ src, poster, className }: { src: string; poster: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        // Autoplay can be refused (data saver, low power); the poster stays.
        video.play().catch(() => {});
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, []);

  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" className={className} />;
}
