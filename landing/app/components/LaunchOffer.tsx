import { LaunchOfferLink } from "./LaunchOfferLink";

export type Offer = {
  code: string;
  productId: string;
  mrpPaise: number;
  discountPaise: number;
  offerPaise: number;
};

// What /api/shop/public-catalogue serves, as far as this site reads it. The
// same reply /shop and /get price from, and the same offers the dashboard shop
// and every order route apply, so a visitor here and a signed-in customer are
// quoted the same figure.
export type Catalogue = {
  products: Record<string, { amountPaise: number; soldOut?: boolean }>;
  // The website offer on each pack that has one ("Auto-apply on the website"
  // in Admin → Promo Codes).
  offers: Record<string, Offer>;
  // The Duo Pack's offer, the one the banner and the hero advertise.
  launchOffer: Offer | null;
  codSurchargePaise: number | null;
  addOns: { id: string; amountPaise: number }[];
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

// Read once on the server, so the prices and the banner are in the HTML the
// visitor first sees. Fetched client-side this used to swap text and insert the
// banner after hydration, which shifted the hero. Any failure is "no catalogue",
// and every price below then falls back to the list price.
export async function getCatalogue(): Promise<Catalogue | null> {
  try {
    const response = await fetch(`${APP_URL}/api/shop/public-catalogue`, {
      headers: { accept: "application/json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (!payload?.ok || !payload.products) return null;
    const launchOffer: Offer | null = payload.launchOffer ?? null;
    return {
      products: payload.products,
      // An app server from before per-pack offers sends only launchOffer.
      offers: payload.offers ?? (launchOffer ? { [launchOffer.productId]: launchOffer } : {}),
      launchOffer,
      codSurchargePaise: typeof payload.codSurchargePaise === "number" ? payload.codSurchargePaise : null,
      addOns: Array.isArray(payload.addOns) ? payload.addOns : [],
    };
  } catch {
    return null;
  }
}

export const money = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

// What one pack costs on the site right now: the offer price when there is one,
// else the catalogue price, else the list price this page was written with.
export function packPaise(catalogue: Catalogue | null, sku: string, listPaise: number): number {
  const offer = catalogue?.offers[sku];
  if (offer) return offer.offerPaise;
  return catalogue?.products[sku]?.amountPaise ?? listPaise;
}

export function LaunchOfferBanner({ offer, shopUrl }: { offer: Offer | null; shopUrl: string }) {
  if (!offer) return null;
  return (
    <LaunchOfferLink
      href={`${shopUrl}?sku=${encodeURIComponent(offer.productId)}`}
      code={offer.code}
      productId={offer.productId}
      className="block bg-[#FEE600] px-4 py-2.5 text-center text-sm font-extrabold text-[#03162D] hover:bg-[#FFE900] transition-colors">
      Offer: Duo Pack for {money(offer.offerPaise)} <span className="font-semibold">({money(offer.discountPaise)} off, code {offer.code} auto-applied)</span> →
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

// The Solo card's price, with the MRP struck through when a website offer is on it.
export function SoloOfferPrice({ catalogue }: { catalogue: Catalogue | null }) {
  const offer = catalogue?.offers["pt-car-1"];
  const price = <span className="text-5xl font-extrabold text-[#03162D] tracking-tight leading-none">{money(packPaise(catalogue, "pt-car-1", 29900))}</span>;
  if (!offer) return price;
  return (
    <span className="inline-flex items-end gap-3">
      {price}
      <span className="mb-1 text-sm text-[#495B7B] line-through">MRP {money(offer.mrpPaise)}</span>
    </span>
  );
}

export function SoloOfferDetails({ catalogue }: { catalogue: Catalogue | null }) {
  const offer = catalogue?.offers["pt-car-1"];
  const price = money(packPaise(catalogue, "pt-car-1", 29900));
  if (!offer) return <>1 vehicle · {price} per tag</>;
  return <>1 vehicle · {money(offer.discountPaise)} off MRP · {offer.code} auto-applied</>;
}

export function DuoOfferButtonLabel({ offer }: { offer: Offer | null }) {
  return <>{offer ? `Get Duo Pack for ${money(offer.offerPaise)}` : "Get Duo Pack"}</>;
}

export function DuoOfferDetails({ offer }: { offer: Offer | null }) {
  if (!offer) return <>1 car · front &amp; back · ₹249.50 per tag · saves ₹99 vs two Solo tags</>;
  return <>{money(offer.offerPaise)} offer price · {money(offer.discountPaise)} off MRP · {offer.code} auto-applied</>;
}

export function HeroOfferLabel({ offer }: { offer: Offer | null }) {
  return <>Duo Pack · 2 tags · {offer ? money(offer.offerPaise) : "₹499"}</>;
}

// "Cash on delivery at ₹448": the pack price the site quotes plus the COD fee,
// which is exactly what the courier collects. Null when the fee is not known,
// so no figure is printed rather than a guessed one.
export function codPaise(catalogue: Catalogue | null, sku: string, listPaise: number): number | null {
  if (catalogue?.codSurchargePaise == null) return null;
  return packPaise(catalogue, sku, listPaise) + catalogue.codSurchargePaise;
}
