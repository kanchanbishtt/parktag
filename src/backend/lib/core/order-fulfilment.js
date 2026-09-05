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
import { sendCapiEventBestEffort, purchaseEventId, isMetaCapiConfigured } from "../integrations/meta-capi.js";
import { firstNameOf, resolveOwnerName } from "./owner-name.js";

// Tell the buyer their order exists, without ever blocking the caller — the
// order already exists by this point, so a notification failure must never turn
// into a failed checkout.
//
// BOTH channels, not one or the other. This used to send the e-mail and return,
// falling through to WhatsApp only for buyers who had no e-mail address on
// file. That made the channel people actually read the consolation prize for
// the minority: an owner who signed up with an e-mail got nothing on WhatsApp,
// even though a confirmation sitting unread in a promotions tab is how a
// completed sale becomes "did my order go through?". A duplicate confirmation
// costs a fraction of a rupee; a missed one costs a support ticket.
//
// Each send is independently guarded so one channel failing cannot silence the
// other — the shape the old early-return could not express.
export async function sendOrderConfirmation(env, collections, ownerId, details, log) {
  try {
    // A guest order has no ownerId at all, so the lookup can only ever miss.
    const owner = ownerId ? await collections.owners.findOne({ _id: ownerId }) : null;
    const track = details.waybill ? trackingUrl(details.waybill) : null;
    const payload = {
      orderNumber: details.orderNumber,
      productName: details.productName,
      amountPaise: details.amountPaise,
      cod: details.cod,
      trackingUrl: track
    };

    // Started TOGETHER, not one after the other. Both are outbound calls to
    // unrelated providers with nothing to say to each other, and this function
    // is awaited on the path a buyer is staring at immediately after their
    // money has left — so running them in sequence spent the e-mail's latency
    // and the WhatsApp's latency end to end when the slower of the two is the
    // real cost. (Delhivery stays ahead of both: the tracking link below is its
    // output, so that one genuinely is a dependency rather than an ordering.)
    //
    // Each promise absorbs its own rejection and reports a boolean, so the
    // Promise.all can never reject and one provider being down cannot stop the
    // other from being tried — the property the old early-return could not
    // express and the reason `reached` exists at all.
    const attempts = [];

    if (owner && owner.email) {
      attempts.push(
        sendOrderConfirmationEmail(env, { to: owner.email, ...payload })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, orderNumber: details.orderNumber }, "[order] confirmation e-mail failed");
            return false;
          })
      );
    }

    // Needs the approved `parktag_order_update` template; best-effort like the
    // e-mail.
    if (details.deliveryPhone && isMetaWhatsappConfigured(env)) {
      attempts.push(
        sendMetaWhatsappOrderUpdate(env, {
          to: details.deliveryPhone,
          // resolveOwnerName, not `displayName || name`: the OTP and Firebase
          // signup paths used to write the phone number itself into
          // displayName, so reading that field raw addressed people as
          // "Hi 9876500123" — in a Meta-approved template, which makes it the
          // one message here nobody can quietly fix after the fact.
          //
          // The delivery name is passed as the second source, which is what
          // resolveOwnerName's `address` argument has always been for and what
          // this call was failing to supply. Sign-in only ever asks for a phone
          // or an e-mail, so an owner who has never filled in the greeting has
          // no displayName worth using and every message opened "Hi there" —
          // while the name they had typed for the courier, on this very order,
          // sat one field away in the same object the phone came from.
          name: firstNameOf(resolveOwnerName(owner || {}, { fullName: details.deliveryName })) || "there",
          orderNumber: details.orderNumber,
          // {{3}} in the approved template. Said plainly, and true at the
          // moment of sending: a waybill exists only once Delhivery has
          // accepted the parcel, and COD is worth naming because it tells the
          // buyer cash is due at the door.
          status: details.waybill
            ? "Confirmed and handed to the courier"
            : details.cod
              ? "Confirmed — Cash on Delivery"
              : "Confirmed and being packed",
          // No tracking link here any more: it is a "Track order" button on the
          // template, and its parameter is the order number above. That removes
          // the empty-string hazard entirely — Meta rejects a blank variable,
          // and a courier link is exactly the value we do not have yet on the
          // confirmations that matter most.
        })
          .then(() => true)
          .catch((err) => {
            log?.error?.({ err, orderNumber: details.orderNumber }, "[order] confirmation WhatsApp failed");
            return false;
          })
      );
    }

    // No attempts at all resolves to [], which is correctly "nobody was
    // reached" rather than a silent success.
    const reached = (await Promise.all(attempts)).some(Boolean);
    if (reached) return;

    // Nothing could be sent, and for a guest this WAS the whole notification:
    // no account to sign into, and — if they closed the tab during payment — an
    // order number they never saw. The order is paid and will ship regardless,
    // but the buyer has not been told and cannot look it up, which is precisely
    // how a completed sale becomes a support ticket. Falling out of this
    // function quietly is what made that invisible; it is an error now, naming
    // the order and the reason, so it is answerable from the logs.
    log?.error?.(
      {
        event: "order-confirmation-undeliverable",
        orderNumber: details.orderNumber,
        guest: !ownerId,
        hasEmail: Boolean(owner && owner.email),
        hasDeliveryPhone: Boolean(details.deliveryPhone),
        whatsappConfigured: isMetaWhatsappConfigured(env)
      },
      "[order] a PAID order could not be confirmed to its buyer — no e-mail on file " +
        "and no WhatsApp channel. They have not been told, and a guest has no order number to track with."
    );
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
    deliveryPhone: order.shippingAddress && order.shippingAddress.phone,
    deliveryName: order.shippingAddress && order.shippingAddress.fullName
  }, log);

  // The purchase conversion, sent server-side.
  //
  // Here rather than at the two call sites because this is the only place that
  // knows an order really transitioned to paid. The conditional update above is
  // the gate: the browser callback and the Razorpay webhook can both arrive, in
  // any order, and exactly one of them gets past it. Firing in verify-payment
  // instead would miss every payment whose buyer closed the tab before the
  // confirmation request — which is precisely the sale the webhook exists to
  // rescue, and precisely the one Meta never heard about.
  //
  // event_id is derived from the order number, so this and the browser's Pixel
  // Purchase resolve to the same string and Meta counts one conversion rather
  // than two. See eventId() in assets/analytics.js.
  // Gated on the same check the sender uses, so an unconfigured environment
  // does not pay for a database round-trip it will only throw away. This sits
  // on the path a customer is waiting on at the end of a payment; dev, staging
  // and any production deploy from before the token was set all take the cheap
  // branch.
  if (isMetaCapiConfigured(env)) {
    const buyer = await collections.owners.findOne({ _id: ownerId });
    sendCapiEventBestEffort(log, env, {
      eventName: "Purchase",
      eventId: purchaseEventId(order.orderNumber),
      actionSource: "website",
      userData: {
        phone: (order.shippingAddress && order.shippingAddress.phone) || buyer?.phone || buyer?.mobile,
        email: buyer?.email
      },
      customData: {
        value: (order.amount || 0) / 100,
        currency: order.currency || "INR",
        content_ids: [order.productId].filter(Boolean),
        content_type: "product"
      },
      testEventCode: env.metaCapiTestEventCode || undefined
    });
  }

  return { firstTime: true, replaced, newTagId };
}
