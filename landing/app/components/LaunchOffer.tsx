import { LaunchOfferLink } from "./LaunchOfferLink";

export type Offer = {
  code: string;
  productId: string;
  mrpPaise: number;
  discountPaise: number;
  offerPaise: number;
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

// Read once on the server, so the price and the banner are in the HTML the
// visitor first sees. Fetched client-side this used to swap text and insert the
// banner after hydration, which shifted the hero. Any failure is "no offer".
export async function getLaunchOffer(): Promise<Offer | null> {
  try {
    const response = await fetch(`${APP_URL}/api/shop/public-catalogue`, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.launchOffer ?? null;
  } catch {
    return null;
  }
}

const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

export function LaunchOfferBanner({ offer, shopUrl }: { offer: Offer | null; shopUrl: string }) {
  if (!offer) return null;
  return (
    <LaunchOfferLink
      href={`${shopUrl}?sku=${encodeURIComponent(offer.productId)}`}
      code={offer.code}
      productId={offer.productId}
      className="block bg-[#FEE600] px-4 py-2.5 text-center text-sm font-extrabold text-[#03162D] hover:bg-[#FFE900] transition-colors">
      Launch offer: Duo Pack for {money(offer.offerPaise)} <span className="font-semibold">({money(offer.discountPaise)} off, code {offer.code} auto-applied)</span> →
    </LaunchOfferLink>
  );
}

export function DuoOfferPrice({ offer }: { offer: Offer | null }) {
  if (!offer) return <span className="text-5xl font-extrabold text-white tracking-tight leading-none">₹499</span>;
  return (
    <span className="inline-flex items-end gap-3">
      <span className="text-5xl font-extrabold text-white tracking-tight leading-none">{money(offer.offerPaise)}</span>
      <span className="mb-1 text-sm text-white/45 line-through">MRP {money(offer.mrpPaise)}</span>
    </span>
  );
}

export function DuoOfferButtonLabel({ offer }: { offer: Offer | null }) {
  return <>{offer ? `Get Duo Pack for ${money(offer.offerPaise)}` : "Get Duo Pack"}</>;
}

export function DuoOfferDetails({ offer }: { offer: Offer | null }) {
  if (!offer) return <>1 car · front &amp; back · ₹249.50 per tag · saves ₹99 vs two Solo tags</>;
  return <>{money(offer.offerPaise)} launch price · {money(offer.discountPaise)} off MRP · {offer.code} auto-applied</>;
}

export function HeroOfferLabel({ offer }: { offer: Offer | null }) {
  return <>Duo Pack · 2 tags · {offer ? money(offer.offerPaise) : "₹499"}</>;
}
