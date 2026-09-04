"use client";
import { useEffect, useState } from "react";

const VEHICLES = ["Bike", "Car", "Truck", "Scooter", "EV", "Bicycle"];

export function VehicleRotator() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    const timer = setInterval(() => {
      // Slide out
      setPhase("out");
      setTimeout(() => {
        setIndex((i) => (i + 1) % VEHICLES.length);
        setPhase("in");
      }, 320);
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      style={{
        display: "inline-block",
        // White, brighter than the white/70 of the sentence around it. The
        // word already draws the eye by moving; colouring it as well was two
        // signals for one job, and it put a third colour in a headline block
        // that already spends red on "private".
        color: "#FFFFFF",
        opacity: phase === "in" ? 1 : 0,
        transform: phase === "in" ? "translateY(0)" : "translateY(-10px)",
        transition: "opacity 320ms ease, transform 320ms ease",
      }}
    >
      {VEHICLES[index]}
    </span>
  );
}
