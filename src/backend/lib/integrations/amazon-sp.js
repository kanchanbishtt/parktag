// Amazon Selling Partner API, read-only: which Amazon.in orders came in.
//
// Only getOrders, and only its non-PII fields (id, status, amount, city,
// state, pincode). Buyer name, phone and street need a Restricted Data Token
// and a separate Amazon approval; nothing here needs them, because Delhivery
// One already has the address and books the waybill itself.
//
// Credentials come from a PRIVATE, self-authorised SP-API app registered in
// Seller Central India (Apps and Services > Develop Apps), Orders role only.

import { fetchWithTimeout } from "../core/fetch-timeout.js";

const LWA_URL = "https://api.amazon.com/auth/o2/token";
// India is served from the EU regional endpoint.
const SP_API_URL = "https://sellingpartnerapi-eu.amazon.com";
export const AMAZON_IN_MARKETPLACE = "A21TJRUUN4KGV";

export function isAmazonConfigured(env) {
  return Boolean(env.amazonLwaClientId && env.amazonLwaClientSecret && env.amazonLwaRefreshToken);
}

// An access token lives an hour and the poll runs every 15 minutes, so one is
// reused across ticks. ponytail: per-process cache, fine for one instance.
let cachedToken = null;

async function accessToken(env) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const res = await fetchWithTimeout(LWA_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: env.amazonLwaRefreshToken,
      client_id: env.amazonLwaClientId,
      client_secret: env.amazonLwaClientSecret
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Amazon sign-in refused: ${data.error_description || data.error || res.status}`);
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

// For tests: forget the cached token between cases.
export function resetAmazonTokenCache() {
  cachedToken = null;
}

/**
 * Seller-fulfilled Amazon.in orders created after `createdAfter` (a Date).
 * Returns [{ amazonOrderId, status, purchasedAt, amountPaise, items, city, state, pincode }].
 * THROWS on any refusal so the caller can retry next tick.
 */
export async function listMerchantOrders(env, { createdAfter }) {
  const token = await accessToken(env);
  const orders = [];
  let nextToken = null;

  // ponytail: stops after 5 pages (500 orders per tick). Far above ParkTag's volume.
  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams(
      nextToken
        ? { MarketplaceIds: AMAZON_IN_MARKETPLACE, NextToken: nextToken }
        : {
            MarketplaceIds: AMAZON_IN_MARKETPLACE,
            CreatedAfter: createdAfter.toISOString(),
            FulfillmentChannels: "MFN"
          }
    );
    const res = await fetchWithTimeout(`${SP_API_URL}/orders/v0/orders?${params}`, {
      headers: { "x-amz-access-token": token }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Amazon orders refused: ${data.errors?.[0]?.message || res.status}`);
    }

    for (const o of data.payload?.Orders || []) {
      orders.push({
        amazonOrderId: o.AmazonOrderId,
        status: o.OrderStatus,
        purchasedAt: o.PurchaseDate,
        amountPaise: Math.round(Number(o.OrderTotal?.Amount || 0) * 100),
        items: Number(o.NumberOfItemsUnshipped || 0) + Number(o.NumberOfItemsShipped || 0),
        city: o.ShippingAddress?.City || "",
        state: o.ShippingAddress?.StateOrRegion || "",
        pincode: o.ShippingAddress?.PostalCode || ""
      });
    }

    nextToken = data.payload?.NextToken;
    if (!nextToken) break;
  }

  return orders;
}
