// Booking a parcel and getting it collected, as one step.
//
// createShipment returns a waybill, which is a printed label and nothing more.
// Until somebody asks Delhivery for a pickup, no rider is dispatched and the
// parcel sits on a desk. Order PT-260804-00006 was lost exactly that way: label
// created on 4 August, no pickup ever requested.
//
// The two calls live together here because createShipment has three callers
// (order-fulfilment.js for prepaid, routes/shop/index.js for COD, and
// scripts/retry-shipment.mjs for manual recovery) and every one of them wants a
// parcel that actually moves. Putting the pair behind one function means a
// fourth caller cannot get the booking without the pickup.
//
// It is not inside createShipment itself because deduplicating the pickup needs
// the database, and lib/integrations is the layer that does not get to touch it.

import { createShipment, requestPickup, nextPickupDate } from "../integrations/delhivery.js";

const DUPLICATE_KEY = 11000;

/**
 * Ask for one pickup per warehouse per day, however many orders arrive.
 *
 * Delhivery dispatches a rider to a LOCATION on a DATE. Asking three times
 * because three people bought a sticker is either rejected as a duplicate or
 * turns into three van visits, so the request has to be deduplicated on
 * (location, date).
 *
 * The dedupe is a claim-first insert against a unique index, copied from
 * message-log.js, and not a read-then-write check: two orders paid in the same
 * second both read "no pickup yet" and both request one. Here the database
 * picks the winner.
 *
 * NEVER THROWS. By the time this runs the money is captured and the label
 * exists, so a courier API having a bad minute must not turn into a failed
 * checkout. Returns { requested, pickupId, forDate, reason, error }.
 */
export async function ensurePickupRequested(env, collections, { pickupDate, expectedPackageCount = 1 } = {}, log) {
  const forDate = pickupDate || nextPickupDate();
  const pickupLocation = env.delhiveryPickupLocation || "";

  let claimId;
  try {
    const { insertedId } = await collections.pickupRequests.insertOne({
      pickupLocation,
      pickupDate: forDate,
      status: "claiming",
      pickupId: null,
      expectedPackageCount,
      createdAt: new Date()
    });
    claimId = insertedId;
  } catch (err) {
    if (err?.code === DUPLICATE_KEY) {
      // Somebody already booked the rider for this day. This is the common
      // path from the second order onward and is not a problem.
      return { requested: false, forDate, reason: "already-requested" };
    }
    log?.error?.({ err, forDate }, "[pickup] could not claim, pickup not requested");
    return { requested: false, forDate, reason: "claim-failed", error: String(err?.message || err) };
  }

  try {
    const result = await requestPickup(env, { pickupDate: forDate, expectedPackageCount });
    await collections.pickupRequests.updateOne(
      { _id: claimId },
      { $set: { status: "requested", pickupId: result.pickupId, requestedAt: new Date() } }
    );
    return { requested: true, pickupId: result.pickupId, forDate };
  } catch (err) {
    // Drop the claim rather than leaving it behind as "requested". A failed
    // attempt that keeps its row would block every later order from retrying,
    // so one bad minute at Delhivery would cost the whole day's dispatch.
    //
    // The cost of this choice: any order that lost the race above has already
    // been told a pickup exists when it does not. The next order of the day
    // re-claims and puts it right, which is why the retry path matters more
    // than the loser being briefly wrong.
    await collections.pickupRequests.deleteOne({ _id: claimId }).catch(() => {});
    log?.error?.({ err, forDate }, "[pickup] Delhivery pickup request failed");
    return { requested: false, forDate, reason: "request-failed", error: String(err?.message || err) };
  }
}

/**
 * Book the parcel, then make sure something comes to collect it.
 *
 * Throws when the BOOKING fails, exactly as createShipment does, because
 * without a waybill there is no parcel and the caller needs to record that.
 * Never throws for the pickup: that failure is reported in the returned
 * `pickup` object for the caller to persist.
 */
export async function bookShipmentAndPickup(env, collections, shipment, log) {
  const booked = await createShipment(env, shipment);

  const pickup = await ensurePickupRequested(
    env,
    collections,
    { pickupDate: nextPickupDate() },
    log
  );

  return { ...booked, pickup };
}
