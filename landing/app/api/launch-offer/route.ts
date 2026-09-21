const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.parktag.me";

export async function GET() {
  try {
    const response = await fetch(`${APP_URL}/api/shop/public-catalogue`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Catalogue returned ${response.status}`);
    const payload = await response.json();
    return Response.json(
      { ok: true, launchOffer: payload?.launchOffer ?? null },
      { headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60" } },
    );
  } catch {
    return Response.json({ ok: true, launchOffer: null });
  }
}
