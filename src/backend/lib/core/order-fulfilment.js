// What happens once an online order is actually paid for.
//
// This used to live inline in POST /api/shop/verify-payment, which meant the
// ONLY thing that could ever mark an order paid was the buyer's browser making
// one more HTTP call from the Razorpay success handler. Close the tab, lose
// signal, or let the phone sleep in the second between Razorpay capturing the
// money and that call going out, and the payment succeeded while the order sat
// at "created" forever: no tag minted, no shipment booked, no confirmation
// sent, and nothing server-side aware that anything was owed. The customer had
// paid and had nothing.
//
// Extracted here so the Razorpay webhook can run exactly the same steps. Two
// independent paths now lead to fulfilment — the browser callback and the
// provider's server-to-server notification — and whichever arrives first does
// the work.
//
// SAFE TO RUN TWICE. The created → paid flip is a single conditional update, so
// only one caller can ever observe `firstTime`; everything with a side effect
// hangs off that. A webhook retry, a duplicate callback, or both racing each
// other cannot mint two tags or book two shipments.
import { toObjectId } from "../auth/auth.js";
import { createPremiumTagForVehicle } from "./tag-issuance.js";
import { reassignVaultDocuments } from "./vault.js";
import { createShipment, isDelhiveryConfigured, trackingUrl } from "../integrations/delhivery.js";
import { sendOrderConfirmationEmail } from "../integrations/email.js";
import { isMetaWhatsappConfigured, sendMetaWhatsappOrderUpdate } from "../integrations/meta.js";

// Fire the order-confirmation e-mail without ever blocking the caller — the
// order already exists, so a mail failure must never turn into a failed
// checkout. Owners who signed in with a mobile OTP may have no e-mail on file;
// we fall back to WhatsApp for those.
export async function sendOrderConfirmation(env, collections, ownerId, details, log) {
  try {
    const owner = await collections.owners.findOne({ _id: ownerId });
    const track = details.waybill ? trackingUrl(details.waybill) : null;
    const payload = {
      orderNumber: details.orderNumber,
      productName: details.productName,
      amountPaise: details.amountPaise,
      cod: details.cod,
      trackingUrl: track
    };
    if (owner && owner.email) {
      await sendOrderConfirmationEmail(env, { to: owner.email, ...payload });
      return;
    }
    // No e-mail on file → WhatsApp the delivery contact instead. Needs the
    // approved `parktag_order_update` template; best-effort like the e-mail.
    if (details.deliveryPhone && isMetaWhatsappConfigured(env)) {
      await sendMetaWhatsappOrderUpdate(env, {
        to: details.deliveryPhone,
        name: (owner && (owner.displayName || owner.name)) || "there",
        orderNumber: details.orderNumber,
        trackingUrl: track || ""
      });
    }
  } catch (err) {
    log?.error?.({ err }, "Order confirmation notification failed");
  }
}

// Mark `order` paid and carry out everything that follows. Returns
// `{ firstTime, replaced, newTagId }`; `firstTime` is false when some other
// caller already fulfilled this order, in which case nothing was done here.
export async function fulfilPaidOrder(env, collections, { order, paymentId, log }) {
  const ownerId = order.ownerId;

  // The gate. A conditional update on `status: "created"` means the database
  // decides the winner, so the browser callback and the webhook can arrive in
  // any order, or simultaneously, and only one proceeds.
  const paidTransition = await collections.shopOrders.updateOne(
    { orderId: order.orderId, status: "created" },
    { $set: { status: "paid", paymentId, paidAt: new Date().toISOString() } }
  );

  if (paidTransition.modifiedCount !== 1) {
    return { firstTime: false, replaced: false, newTagId: null };
  }

  let replaced = false;
  let newTagId = null;

  // Tag replacement (M18): mint a new premium tag for the vehicle and
  // soft-remove the spent free-trial tag.
  if (order.replaceTagId) {
    const oldTag = await collections.tags.findOne({
      _id: toObjectId(order.replaceTagId),
      ownerId,
      deletedAt: { $in: [null, undefined] }
    });
    if (oldTag && !oldTag.premium) {
      const premiumTag = await createPremiumTagForVehicle(collections, ownerId, {
        plateNumber: oldTag.plateNumber,
        vehicleType: oldTag.vehicleType,
        vehicleLabel: oldTag.vehicleLabel
      });
      const now = new Date().toISOString();
      await collections.tags.updateOne(
        { _id: oldTag._id },
        { $set: { deletedAt: now, status: "inactive", updatedAt: now } }
      );
      newTagId = String(premiumTag._id);
      replaced = true;

      // Carry the vehicle's documents across to the tag that replaces it. This
      // is the SAME car — the owner has upgraded its sticker, not sold it — but
      // the vault files documents against a tag id, and the vault refuses a
      // soft-deleted tag. Without this the owner's RC, insurance and licence
      // became unreachable the moment the upgrade was paid for.
      await reassignVaultDocuments(collections, ownerId, oldTag._id, premiumTag._id);
      await collections.shopOrders.updateOne(
        { orderId: order.orderId },
        { $set: { mintedTagId: newTagId } }
      );
    }
  }

  // Auto-book the Delhivery shipment. Best-effort: the payment has already
  // succeeded and the tag is already minted by this point, so a booking failure
  // must never propagate — it goes on the order for retry instead.
  let bookedWaybill = null;
  if (isDelhiveryConfigured(env) && order.shippingAddress) {
    try {
      const { waybill } = await createShipment(env, {
        orderId: order.orderId,
        address: order.shippingAddress,
        productName: order.productName
      });
      bookedWaybill = waybill;
      await collections.shopOrders.updateOne(
        { orderId: order.orderId },
        { $set: { waybill, shipmentBookedAt: new Date().toISOString() }, $unset: { shipmentError: "" } }
      );
    } catch (err) {
      log?.error?.({ err, orderId: order.orderId }, "Delhivery shipment booking failed");
      await collections.shopOrders.updateOne(
        { orderId: order.orderId },
        { $set: { shipmentError: err instanceof Error ? err.message : "Unknown error" } }
      );
    }
  }

  // Sent after booking so it can carry the tracking link when a waybill exists.
  await sendOrderConfirmation(env, collections, ownerId, {
    orderNumber: order.orderNumber,
    productName: order.productName,
    amountPaise: order.amount,
    cod: false,
    waybill: bookedWaybill,
    deliveryPhone: order.shippingAddress && order.shippingAddress.phone
  }, log);

  return { firstTime: true, replaced, newTagId };
}
