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
          autoApply: true,
          active: true,
          createdAt: now,
          createdBy: "system:commerce-defaults"
        }
      },
      { upsert: true }
    );
    // LAUNCH100 was the website offer before "Auto-apply on the website" was a
    // switch. A row that has never had the switch gets it on, once; after that
    // the admin's choice stands, the same bargain as $setOnInsert above.
    await collections.promoCodes.updateOne(
      { code: "LAUNCH100", autoApply: { $exists: false } },
      { $set: { autoApply: true } }
    );
  } catch (error) {
    log?.warn?.({ err: error }, "[commerce] default launch offer could not be ensured");
  }
}
