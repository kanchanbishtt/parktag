// Record a sale that never went through the shop.
//
//   node --env-file=.env src/backend/scripts/record-manual-order.mjs \
//     --name "Shivam Srivastav" --product pt-car-1 --amount 299 \
//     --date 2026-08-23 --method upi --ref "gpay-23aug" --city Noida --prefix prod_
//
//   ...then re-run with --commit to actually write it.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// Three real customers bought ParkTags over WhatsApp: paid by UPI, handed the
// sticker over in person, no checkout involved. None of them exist in
// shop_orders, so the daily report showed 1 order for the month when the true
// figure was 4. The database was not wrong; it had simply never been told.
//
// Until the admin panel grows a manual-order form (Phase 1 of the admin brief),
// this is how those sales get counted.
//
// ── What it deliberately does NOT do ───────────────────────────────────────
//
// It does not run fulfilment. No Delhivery booking, no pickup request, no
// confirmation message to the buyer. These parcels were hand-delivered and the
// customer was standing there; sending them a "your order is confirmed" days
// later would be worse than silence. It writes a record and nothing else.
//
// Dry run is the default. --commit is required, because this writes to the
// collection every revenue figure is drawn from.

import { getEnv } from "../lib/env.js";
import { getCollections } from "../lib/db/repositories.js";
import { closeMongoConnection } from "../lib/db/mongo.js";
import { getShopProduct, SHOP_PRODUCTS } from "../lib/integrations/payments.js";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const name = arg("name");
const productId = arg("product");
const amountRupees = arg("amount");
const saleDate = arg("date");
const method = arg("method");
const ref = arg("ref");
const phone = arg("phone");
const city = arg("city") || "Noida";
const state = arg("state") || "Uttar Pradesh";
const note = arg("note");
const channel = arg("channel") || "whatsapp";
const prefix = arg("prefix");
const doCommit = process.argv.includes("--commit");

const required = { name, product: productId, amount: amountRupees, date: saleDate, method, ref, prefix };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`\nMissing: ${missing.join(", ")}`);
  console.error(`\nUsage: --name <buyer> --product <id> --amount <rupees> --date <YYYY-MM-DD>`);
  console.error(`       --method <upi|cash|bank> --ref <payment reference> --prefix <prod_|dev_>`);
  console.error(`       [--phone <10 digits>] [--city <city>] [--state <state>] [--note <text>] [--commit]`);
  console.error(`\nProducts: ${Object.keys(SHOP_PRODUCTS).join(", ")}\n`);
  process.exit(1);
}

const product = getShopProduct(productId);
if (!product) {
  console.error(`\nUnknown product "${productId}". Known: ${Object.keys(SHOP_PRODUCTS).join(", ")}\n`);
  process.exit(1);
}

if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) {
  console.error(`\n--date must be YYYY-MM-DD, got "${saleDate}"\n`);
  process.exit(1);
}

const amountPaise = Math.round(Number(amountRupees) * 100);
if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
  console.error(`\n--amount must be a positive number of rupees, got "${amountRupees}"\n`);
  process.exit(1);
}

const env = { ...getEnv(), mongoCollectionPrefix: prefix };
const collections = await getCollections(env);

// The reference is the natural key. A UPI transaction id, or whatever the
// operator typed, but the same sale run twice must not become two rows in the
// figures somebody reports to themselves as revenue.
const existing = await collections.shopOrders.findOne({ channel, paymentRef: ref });
if (existing) {
  console.error(`\nAlready recorded as ${existing.orderNumber} (${existing.createdAt}). Nothing to do.\n`);
  await closeMongoConnection();
  process.exit(1);
}

// Backdated on purpose. generateOrderNumber stamps TODAY into the prefix, which
// would label a 23 August sale as a September one and put it in the wrong
// month's revenue. The sequence still comes from the shared counter, so the
// number is still unique across every order ParkTag has ever issued.
const seqDoc = await collections.counters.findOneAndUpdate(
  { _id: "shopOrder" },
  { $inc: { seq: 1 } },
  { upsert: true, returnDocument: "after" }
);
const seq = (seqDoc && (seqDoc.seq ?? (seqDoc.value && seqDoc.value.seq))) || 1;
const orderNumber = `PT-${saleDate.slice(2).replace(/-/g, "")}-${String(seq).padStart(5, "0")}`;

const doc = {
  orderNumber,
  orderId: `manual_${ref}`,
  productId,
  productName: product.name,
  amount: amountPaise,
  currency: "INR",
  status: "paid",
  guest: true,
  ownerId: null,
  // What makes this row distinguishable from a shop checkout, for anything that
  // later wants to measure the shop funnel without counting hand-sold tags.
  channel,
  manualEntry: true,
  paymentMethod: method,
  paymentRef: ref,
  ...(note ? { note } : {}),
  shippingAddress: {
    fullName: name,
    ...(phone ? { phone } : {}),
    city,
    state,
    country: "India"
  },
  // Hand-delivered, so there is no courier leg at all. Recorded explicitly so
  // the stuck-order alert does not report these as parcels nobody collected.
  deliveredInPerson: true,
  createdAt: `${saleDate}T12:00:00.000Z`,
  paidAt: `${saleDate}T12:00:00.000Z`,
  recordedAt: new Date().toISOString()
};

console.log(`\n${doCommit ? "WRITING" : "DRY RUN"}  ${prefix}shop_orders\n`);
console.log(JSON.stringify(doc, null, 2));

if (!doCommit) {
  console.log(`\nNothing written. Re-run with --commit to record this order.\n`);
  // The sequence was already consumed by the counter above. That is deliberate:
  // a gap in order numbers is harmless, and rolling it back would race any real
  // checkout happening at the same moment.
  await closeMongoConnection();
  process.exit(0);
}

await collections.shopOrders.insertOne(doc);
console.log(`\n  Recorded ${orderNumber}  ${product.name}  Rs ${(amountPaise / 100).toFixed(2)}  (${channel}, ${method})\n`);

await closeMongoConnection();
