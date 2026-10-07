// Orders, for an admin to check what was bought, for how much, paid how, and
// where it is going.
//
//   GET /api/admin/orders?view=sales|abandoned|ours|all&q=&page=
//
// Every figure here is read off the stored order and rendered by the same
// helpers the rest of the system uses: the price breakdown by orderBreakdown
// (what the buyer saw and what Razorpay carries), the address by addressLine
// (what the courier was given), the delivery state by deliveryStateOf (what
// the Activations page shows), the sticker capacity by capacityOf (what
// linking uses). Nothing is recomputed from scratch, so this page cannot
// disagree with the pages next to it.
//
// Views:
//   sales      paid, or a placed COD — a real sale (the default)
//   abandoned  created and never paid: the checkout opened, the buyer left
//   ours       the team's own test orders (internal phone or internal channel)
//   all        everything, including ours
// Deleted orders are never listed.

import { ObjectId } from "mongodb";

import { requireSession } from "../../lib/auth/auth.js";
import { getCollections } from "../../lib/db/repositories.js";
import { addressLine } from "../../lib/core/address.js";
import { orderBreakdown, breakdownText } from "../../lib/core/order-breakdown.js";
import { capacityOf } from "../../lib/core/order-linking.js";
import { trackingUrl } from "../../lib/integrations/delhivery.js";
import { deliveryStateOf } from "./index.js";

const PAGE_SIZE = 50;
const VIEWS = ["sales", "abandoned", "ours", "all"];

const NOT_DELETED = { deletedAt: { $in: [null, undefined] } };
const OURS = { $or: [{ internal: true }, { channel: "internal" }] };
const NOT_OURS = { internal: { $ne: true }, channel: { $ne: "internal" } };

function viewFilter(view) {
  switch (view) {
    case "abandoned": return { ...NOT_DELETED, ...NOT_OURS, status: "created" };
    case "ours": return { ...NOT_DELETED, ...OURS };
    case "all": return { ...NOT_DELETED };
    default: return { ...NOT_DELETED, ...NOT_OURS, status: { $in: ["paid", "cod"] } };
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toObjectId(value) {
  try { return new ObjectId(String(value)); } catch { return null; }
}

// How the buyer paid, in the four words the page shows.
//   online        paid through Razorpay at checkout
//   cod           cash on delivery, still due
//   cod_prepaid   placed as COD, then paid online before delivery
//   manual        a sale recorded by hand (UPI, cash...): the method is in
//                 paymentMethod and the page shows that word
function paymentModeOf(order) {
  if (order.paymentMethod === "cod" || order.status === "cod") {
    return order.status === "paid" && order.paymentId ? "cod_prepaid" : "cod";
  }
  if (order.manualEntry === true || (order.paymentMethod && !["online", "razorpay", "upi_online"].includes(order.paymentMethod) && !order.paymentId)) {
    return "manual";
  }
  return "online";
}

// What the order is worth to the books, in paise: what was paid, or what the
// courier will collect. An abandoned checkout is worth nothing yet.
function amountOf(order) {
  if (order.status === "created") return Number(order.amount) || 0;
  if (paymentModeOf(order) === "cod_prepaid" && Number.isFinite(Number(order.prepayAmount))) return Number(order.prepayAmount);
  return Number(order.amount) || 0;
}

function orderRow(order, owner) {
  const ship = order.shippingAddress || {};
  const delivery = deliveryStateOf(order);
  const stickers = capacityOf(order);
  const linked = Array.isArray(order.assignedTagIds) ? order.assignedTagIds.length : 0;
  let breakdown = null;
  try { breakdown = breakdownText(orderBreakdown(order)) || null; } catch { breakdown = null; }

  return {
    id: String(order._id),
    orderNumber: order.orderNumber || null,
    orderId: order.orderId || null,
    createdAt: order.createdAt || null,
    paidAt: order.paidAt || null,
    status: order.status || null,
    paymentMode: paymentModeOf(order),
    paymentMethod: order.paymentMethod || null,
    paymentId: order.paymentId || null,
    paymentRef: order.paymentRef || null,
    channel: order.channel || "shop",
    internal: order.internal === true || order.channel === "internal",
    manualEntry: order.manualEntry === true,
    guest: order.guest === true,
    product: {
      id: order.productId || null,
      name: order.productName || null,
      quantity: Math.max(1, Number(order.quantity) || 1),
      addOns: Array.isArray(order.addOns) ? order.addOns.map((a) => a && a.name).filter(Boolean) : []
    },
    // Paise, as stored; the page formats rupees.
    amountPaise: amountOf(order),
    listedPaise: Number(order.amount) || 0,
    codSurchargePaise: Number(order.codSurchargePaise) || 0,
    promoCode: order.promoCode || null,
    promoDiscountPaise: Number(order.promoDiscountPaise) || 0,
    referralDiscountPaise: Number(order.referralDiscountPaise) || 0,
    priceBreakdown: breakdown,
    address: {
      fullName: ship.fullName || ship.name || null,
      phone: ship.phone || null,
      email: ship.email || order.email || null,
      line1: ship.line1 || null,
      line2: ship.line2 || null,
      landmark: ship.landmark || null,
      city: ship.city || null,
      state: ship.state || null,
      pincode: ship.pincode || null,
      line: addressLine(ship) || null
    },
    delivery,
    waybill: order.waybill || null,
    trackingUrl: order.waybill ? trackingUrl(order.waybill) : null,
    courierStatus: order.trackingCache?.status || null,
    stickers: { capacity: stickers, linked, mintedTagId: order.mintedTagId ? String(order.mintedTagId) : null, replaceTagId: order.replaceTagId ? String(order.replaceTagId) : null },
    owner: owner ? { id: String(owner._id), name: owner.displayName || null, mobile: owner.mobile || owner.phone || null, email: owner.email || null } : null,
    attribution: order.attribution && typeof order.attribution === "object"
      ? { source: order.attribution.utm_source || order.attribution.source || null, medium: order.attribution.utm_medium || order.attribution.medium || null, campaign: order.attribution.utm_campaign || order.attribution.campaign || null }
      : null,
    note: order.note || null
  };
}

export function registerAdminOrderRoutes(app, env) {
  app.get("/api/admin/orders", async (request, reply) => {
    const blocked = await requireSession(app, "admin")(request, reply);
    if (blocked) return blocked;

    const collections = await getCollections(env);
    const view = VIEWS.includes(request.query.view) ? request.query.view : "sales";
    const q = String(request.query.q || "").trim().slice(0, 80);
    const requestedPage = parseInt(request.query.page || "1", 10);
    const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    const filter = viewFilter(view);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const or = [
        { orderNumber: rx }, { orderId: rx }, { paymentId: rx }, { paymentRef: rx }, { waybill: rx },
        { productName: rx }, { promoCode: rx },
        { "shippingAddress.fullName": rx }, { "shippingAddress.name": rx }, { "shippingAddress.city": rx }, { "shippingAddress.pincode": rx }
      ];
      // A number is looked up by its digits, whatever spelling it was stored
      // in: "+91 91234 56780" and "9123456780" must both find the order, so
      // an Indian number is matched on its last ten digits.
      const digits = q.replace(/\D/g, "");
      const national = /^91\d{10}$/.test(digits) ? digits.slice(2) : digits;
      if (national.length >= 4) or.push({ "shippingAddress.phone": new RegExp(escapeRegex(national)) });
      filter.$and = [{ $or: or }];
    }

    const [matching, sales, abandoned, ours, all, rows] = await Promise.all([
      collections.shopOrders.countDocuments(filter),
      collections.shopOrders.countDocuments(viewFilter("sales")),
      collections.shopOrders.countDocuments(viewFilter("abandoned")),
      collections.shopOrders.countDocuments(viewFilter("ours")),
      collections.shopOrders.countDocuments(viewFilter("all")),
      collections.shopOrders
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .toArray()
    ]);

    // ownerId is an ObjectId on most orders and a string on some older ones.
    const ownerIds = [...new Set(rows.map((o) => o.ownerId && String(o.ownerId)).filter(Boolean))].map(toObjectId).filter(Boolean);
    const owners = ownerIds.length
      ? await collections.owners.find({ _id: { $in: ownerIds } }, { projection: { displayName: 1, mobile: 1, phone: 1, email: 1 } }).toArray()
      : [];
    const ownerById = new Map(owners.map((o) => [String(o._id), o]));

    return {
      ok: true,
      view,
      counts: { sales, abandoned, ours, all, matching },
      page,
      pages: Math.max(1, Math.ceil(matching / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
      orders: rows.map((o) => orderRow(o, o.ownerId ? ownerById.get(String(o.ownerId)) || null : null))
    };
  });
}
