"use client";

import { useEffect, useState } from "react";

type Offer = {
  code: string;
  productId: string;
  mrpPaise: number;
  discountPaise: number;
  offerPaise: number;
};

function useLaunchOffer() {
  const [offer, setOffer] = useState<Offer | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/launch-offer", { headers: { accept: "application/json" } })
      .then((response) => response.json())
      .then((payload) => { if (alive) setOffer(payload?.launchOffer ?? null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return offer;
}

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function LaunchOfferBanner({ shopUrl }: { shopUrl: string }) {
  const offer = useLaunchOffer();
  if (!offer) return null;
  return (
    <a href={`${shopUrl}?sku=${encodeURIComponent(offer.productId)}`} className="block bg-[#FEE600] px-4 py-2.5 text-center text-sm font-extrabold text-[#03162D] hover:bg-[#FFE900] transition-colors">
      Launch offer: Duo Pack for {money(offer.offerPaise)} <span className="font-semibold">({money(offer.discountPaise)} off, code {offer.code} auto-applied)</span> →
    </a>
  );
}

export function DuoOfferPrice() {
  const offer = useLaunchOffer();
  if (!offer) return <span className="text-5xl font-extrabold text-white tracking-tight leading-none">₹499</span>;
  return (
    <span className="inline-flex items-end gap-3">
      <span className="text-5xl font-extrabold text-white tracking-tight leading-none">{money(offer.offerPaise)}</span>
      <span className="mb-1 text-sm text-white/45 line-through">MRP {money(offer.mrpPaise)}</span>
    </span>
  );
}

export function DuoOfferButtonLabel() {
  const offer = useLaunchOffer();
  return <>{offer ? `Get Duo Pack for ${money(offer.offerPaise)}` : "Get Duo Pack"}</>;
}

export function DuoOfferDetails() {
  const offer = useLaunchOffer();
  if (!offer) return <>1 car · front &amp; back · ₹249.50 per tag · saves ₹99 vs two Solo tags</>;
  return <>{money(offer.offerPaise)} launch price · {money(offer.discountPaise)} off MRP · {offer.code} auto-applied</>;
}

export function HeroOfferLabel() {
  const offer = useLaunchOffer();
  return <>Duo Pack · 2 tags · {offer ? money(offer.offerPaise) : "₹499"}</>;
}
