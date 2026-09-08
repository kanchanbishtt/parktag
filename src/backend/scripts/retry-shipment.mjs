// Re-book a shipment for an order whose booking failed.
//
//   node --env-file=.env src/backend/scripts/retry-shipment.mjs --order PT-260908-00013 --prefix prod_
//   node --env-file=.env src/backend/scripts/retry-shipment.mjs --order PT-260908-00013 --prefix prod_ --book
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Shipment booking is best-effort by design: the payment has already succeeded
// and the tag is already minted by the time Delhivery is called, so a booking
// failure is recorded on the order and never propagated. That is right — a
// courier outage must not fail a checkout — but nothing ever retried it, so a
// failure meant a paying customer silently never received anything.
//
// PT-260908-00013 is what made that concrete: paid, confirmed by WhatsApp, and
// unshippable because the Delhivery wallet had been drained to minus Rs 660 by
// the test suite booking 39 phantom shipments (see lib/core/external-guard.js).
//
//   "Prepaid client manifest charge API failed due to insufficient balance"
//
// ── The two things this refuses to do ──────────────────────────────────────
//
// It will not book blind. Delhivery's own error says "Package might have been
// partially saved", so a naive retry can create a SECOND parcel for the same
// order: two labels, two pickups, two charges, one customer. Every run queries
// Delhivery by the reference id first and stops if anything already exists.
//
// It will not act unless asked. Dry run is the default and --book is required,
// because this spends money on a live courier account.

import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { createShipment, isDelhiveryConfigured, trackingUrl } from "../lib/integrations/delhivery.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const orderNumber = arg("order");
const prefix = arg("prefix");
const doBook = process.argv.includes("--book");

// No defaults for either. A default prefix is how a script written for one
// environment quietly runs against another, and this one books parcels.
if (!orderNumber || !prefix) {
  console.error("Usage: --order <PT-...> --prefix <prod_|dev_> [--book]");
  process.exit(1);
}

const env = { ...getEnv(), mongoCollectionPrefix: prefix };

if (!isDelhiveryConfigured(env)) {
  console.error("Delhivery is not configured in this environment.");
  process.exit(1);
}

const collections = await getCollections(env);
const order = await collections.shopOrders.findOne({ orderNumber });

if (!order) {
  console.error(`No order ${orderNumber} in ${prefix}shop_orders.`);
  await closeMongoConnection();
  process.exit(1);
}

console.log(`\n${orderNumber}  (${prefix}shop_orders)`);
console.log(`  status      ${order.status}`);
console.log(`  paid        Rs ${(order.amount / 100).toFixed(2)}`);
console.log(`  product     ${order.productName}`);
console.log(`  ship to     ${order.shippingAddress?.fullName}, ${order.shippingAddress?.city} ${order.shippingAddress?.pincode}`);
console.log(`  waybill     ${order.waybill || "(none)"}`);
if (order.shipmentError) console.log(`  last error  ${order.shipmentError}`);

if (order.waybill) {
  console.log(`\nThis order already has a waybill. Nothing to do.\n`);
  await closeMongoConnection();
  process.exit(0);
}

if (!["paid", "cod"].includes(order.status)) {
  console.error(`\nRefusing: status is "${order.status}", so no money has been taken for this order.\n`);
  await closeMongoConnection();
  process.exit(1);
}

// The duplicate check, before anything is spent.
//
// Both references are tried because the two booking paths send different ones:
// fulfilPaidOrder sends the Razorpay order id, place-cod sends the order
// number. A partially-saved package could be filed under either.
const refs = [order.orderId, order.orderNumber].filter(Boolean);
console.log(`\nChecking Delhivery for an existing package (${refs.join(", ")})...`);

let existing = null;
for (const ref of refs) {
  const url = `${env.delhiveryBaseUrl}/api/v1/packages/json/?ref_ids=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${env.delhiveryApiKey}`, Accept: "application/json" }
  }).catch(() => null);
  const data = res && res.ok ? await res.json().catch(() => null) : null;
  const found = data?.ShipmentData?.[0]?.Shipment;
  if (found?.AWB) {
    existing = found;
    break;
  }
}

if (existing) {
  // Found rather than booked. The waybill is written back so the order stops
  // looking unshipped, and NO second parcel is created.
  console.log(`\n  A package already exists: ${existing.AWB} (${existing.Status?.Status || "unknown status"})`);
  if (!doBook) {
    console.log(`  Re-run with --book to record this waybill against the order.\n`);
  } else {
    await collections.shopOrders.updateOne(
      { orderNumber },
      { $set: { waybill: existing.AWB, shipmentError: null, shipmentRecoveredAt: new Date().toISOString() } }
    );
    console.log(`  Recorded against the order. No new shipment was created.\n`);
  }
  await closeMongoConnection();
  process.exit(0);
}

console.log("  None. This order has no shipment at Delhivery.");

if (!doBook) {
  console.log(`\nDRY RUN. Re-run with --book to create the shipment.`);
  console.log(`Make sure the Delhivery wallet is in credit first, or the booking fails the same way.\n`);
  await closeMongoConnection();
  process.exit(0);
}

console.log("\nBooking...");
try {
  const { waybill } = await createShipment(env, {
    orderId: order.orderId || order.orderNumber,
    address: order.shippingAddress,
    productName: order.productName,
    // COD collects at the door; a prepaid order must collect nothing, or the
    // customer is charged twice for the same tag.
    codAmountPaise: order.paymentMethod === "cod" ? order.amount : 0
  });

  await collections.shopOrders.updateOne(
    { orderNumber },
    { $set: { waybill, shipmentError: null, shipmentRecoveredAt: new Date().toISOString() } }
  );

  console.log(`  Booked: ${waybill}`);
  console.log(`  Track:  ${trackingUrl(waybill)}\n`);
} catch (err) {
  console.error(`\n  Failed: ${err.message}\n`);
  await collections.shopOrders.updateOne(
    { orderNumber },
    { $set: { shipmentError: String(err.message).slice(0, 400) } }
  );
  await closeMongoConnection();
  process.exit(1);
}

await closeMongoConnection();
