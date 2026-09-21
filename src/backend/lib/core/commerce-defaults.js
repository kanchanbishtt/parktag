// Idempotent commerce defaults that should exist in every environment.
// `$setOnInsert` is deliberate: after the first boot the admin dashboard owns
// the row. Revoking LAUNCH100 must stay revoked across every deploy.
export async function ensureCommerceDefaults(collections, log) {
  if (!collections) return;
  try {
    const now = new Date().toISOString();
    await collections.promoCodes.updateOne(
      { code: "LAUNCH100" },
      {
        $setOnInsert: {
          code: "LAUNCH100",
          discountMode: "flat",
          discountPaise: 10000,
          shippingFeePaise: 0,
          productIds: ["pt-car-2"],
          singleUse: false,
          boundPhone: null,
          maxUses: null,
          usedCount: 0,
          usedByOrders: [],
          expiresAt: null,
          fulfilment: "ship",
          active: true,
          createdAt: now,
          createdBy: "system:commerce-defaults"
        }
      },
      { upsert: true }
    );
  } catch (error) {
    log?.warn?.({ err: error }, "[commerce] default launch offer could not be ensured");
  }
}
