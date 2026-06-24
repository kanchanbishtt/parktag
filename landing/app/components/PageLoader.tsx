"use client";
import { useEffect, useState, ReactNode } from "react";

function Bone({ w = "100%", h = "15px", radius = "6px" }: { w?: string; h?: string; radius?: string }) {
  return (
    <div
      className="skeleton-shimmer"
      style={{ width: w, height: h, borderRadius: radius, flexShrink: 0 }}
    />
  );
}

function SkeletonScreen() {
  return (
    <div style={{ minHeight: "100vh", background: "#fff" }}>

      {/* Nav */}
      <div style={{
        height: 64,
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        padding: "0 24px",
        gap: 32,
      }}>
        <Bone w="110px" h="26px" />
        <div style={{ display: "flex", gap: 24, flex: 1 }}>
          {[68, 76, 52, 52, 44, 44].map((w, i) => (
            <Bone key={i} w={`${w}px`} h="13px" />
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Bone w="30px" h="30px" radius="50%" />
          <Bone w="26px" h="17px" radius="3px" />
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px 80px", display: "flex", flexDirection: "column", gap: 16 }}>
        <Bone w="52%" h="38px" />
        <Bone w="72%" h="20px" />
        <Bone w="60%" h="20px" />
        <div style={{ height: 20 }} />
        {[100, 95, 100, 82, 100, 90, 68, 100, 94, 78, 100, 85].map((pct, i) => (
          <Bone key={i} w={`${pct}%`} h="14px" />
        ))}
        <div style={{ height: 16 }} />
        {[100, 88, 100, 72, 95].map((pct, i) => (
          <Bone key={i} w={`${pct}%`} h="14px" />
        ))}
      </div>

    </div>
  );
}

export function PageLoader({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<"show" | "fade" | "done">("show");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("fade"), 200);   // start fade after 200ms
    const t2 = setTimeout(() => setPhase("done"), 560);   // remove overlay after fade
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <>
      {/* Real content always in DOM */}
      {children}

      {/* Skeleton overlay fades out on top */}
      {phase !== "done" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            opacity: phase === "show" ? 1 : 0,
            transition: "opacity 360ms ease",
            pointerEvents: phase === "show" ? "auto" : "none",
          }}
        >
          <SkeletonScreen />
        </div>
      )}
    </>
  );
}
