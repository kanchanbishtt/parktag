// Replies to the review request (campaigns/review-request.js), kept for an
// admin to pick from.
//
// One row per order. WhatsApp sends a line of text and a photo as separate
// messages more often than not, so each reply is appended to the order's row
// rather than becoming a review of its own; approving the row approves what the
// buyer said as a whole.
//
// A reply is only a review if it comes from a number we asked, recently.
// Everything else the webhook receives (a scanner answering an alert, a
// support question) is left alone.

import { ObjectId } from "mongodb";

import { toE164 } from "./phone.js";
import { firstNameOf } from "./owner-name.js";
import { fetchMetaWhatsappMedia } from "../integrations/meta.js";

const REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_TEXT = 1000;
const MAX_PHOTOS = 3;

// Served from our own origin, so only plain raster images: a stored
// content type of text/html would otherwise be a page we host.
const SAFE_IMAGE = /^image\/(jpeg|png|webp)$/;

/**
 * Store an inbound WhatsApp message as a review reply, if it answers a review
 * request sent to that number in the last 14 days. Returns true when stored.
 * `fetchMedia` is injectable so a test never reaches the Graph API.
 */
export async function recordReviewReply(env, collections, message, { fetchMedia = fetchMetaWhatsappMedia } = {}) {
  const phone = toE164(message?.from);
  if (!phone) return false;

  const text = String(message?.text?.body || message?.image?.caption || "").trim().slice(0, MAX_TEXT);
  const mediaId = message?.type === "image" ? message.image?.id : null;
  if (!text && !mediaId) return false;

  const since = new Date(Date.now() - REPLY_WINDOW_MS).toISOString();
  const order = await collections.shopOrders.findOne(
    { reviewRequestPhone: phone, reviewRequestSentAt: { $gte: since } },
    { sort: { reviewRequestSentAt: -1 }, projection: { orderNumber: 1, shippingAddress: 1 } }
  );
  if (!order) return false;

  const push = {};
  if (text) push.texts = text;
  if (mediaId) {
    // Bytes are downloaded now: Meta only keeps inbound media for a while,
    // and a review picked for the website months later needs its photo.
    const media = await fetchMedia(env, mediaId);
    push.photos = { mediaId, ...(media || {}) };
  }

  const now = new Date();
  const upsert = () => collections.reviews.updateOne(
    { orderId: order._id },
    {
      $setOnInsert: {
        orderId: order._id,
        orderNumber: order.orderNumber || null,
        phone,
        name: firstNameOf(order.shippingAddress?.fullName) || null,
        approved: false,
        createdAt: now
      },
      $set: { receivedAt: now },
      // $slice caps a chatty buyer; the cap is on what is kept, not received.
      $push: Object.fromEntries(
        Object.entries(push).map(([k, v]) => [k, { $each: [v], $slice: k === "photos" ? MAX_PHOTOS : 20 }])
      )
    },
    { upsert: true }
  );
  // Text and photo usually arrive as two webhook calls a moment apart. If both
  // try to create the row, one loses on the unique orderId index; the retry
  // finds the row the other made and appends to it.
  await upsert().catch((err) => {
    if (err?.code !== 11000) throw err;
    return upsert();
  });
  return true;
}

// Photo bytes never travel in a list response; they have their own route.
export const LIST_PROJECTION = { "photos.data": 0 };

export function hasPhoto(review) {
  return Array.isArray(review.photos) && review.photos.some((p) => p && SAFE_IMAGE.test(p.mimeType));
}

/** The public shape. First name, words, photo link. Nothing that identifies. */
export function toPublicReview(review) {
  const id = String(review._id);
  return {
    id,
    name: review.name || "A ParkTag owner",
    text: (review.texts || []).join(" "),
    photoUrl: hasPhoto(review) ? `/api/shop/reviews/${id}/photo` : null,
    receivedAt: review.receivedAt || null
  };
}

export function reviewObjectId(value) {
  try {
    return new ObjectId(String(value));
  } catch {
    return null;
  }
}

// The first stored photo, as { data, mimeType }, or null.
export function firstPhoto(review) {
  const photo = (review?.photos || []).find((p) => p && p.data && SAFE_IMAGE.test(p.mimeType));
  if (!photo) return null;
  // The driver hands Binary back, not Buffer.
  const data = Buffer.isBuffer(photo.data)
    ? photo.data
    : Buffer.from(photo.data.buffer).subarray(0, photo.data.position);
  return { data, mimeType: photo.mimeType };
}
