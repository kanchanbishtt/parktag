// Field-demo stock.
//
// A small, fixed set of premium stickers a salesperson carries. They are listed
// on the demo shelf and otherwise behave like any other printed sticker: the
// customer scans the QR and runs the REAL activation flow. Nothing has to be
// unlocked first — the shelf simply notices when one of its stickers gets
// activated and shows it as ACTIVATED.
//
// LIFECYCLE
//
//   available   a new sticker, nothing on it. Ready for the next customer.
//   activated   somebody completed activation. Their details are on the tag.
//                 └─ Deactivate → wipe everything, back to available
//                 └─ Sold       → this unit is sold; stays listed as a record
//
// The resting state is "unclaimed" — the same state every un-activated sticker
// in the world sits in — because that is precisely what a fresh demo sticker
// is. Deactivating returns it there, so the next customer's activation is
// indistinguishable from a brand-new sticker's.
export const MARKETING_AVAILABLE_STATUS = "unclaimed";
export const MARKETING_ACTIVATED_STATUS = "active";

export function isMarketingStock(tag) {
  return Boolean(tag?.marketingStock);
}

export function isSold(tag) {
  return Boolean(tag?.soldAt);
}

// Somebody has activated this sticker and their details are on it. This is the
// state Deactivate undoes and Sold makes permanent.
export function isDemoActivated(tag) {
  return isMarketingStock(tag) && !isSold(tag) && Boolean(tag?.demoOwnerId);
}

// What the salesperson is looking at: available | activated | sold.
export function demoState(tag) {
  if (isSold(tag)) return "sold";
  if (isDemoActivated(tag)) return "activated";
  return "available";
}

// Why a sticker cannot be acted on, or null when it can. Returns a reason
// rather than a boolean so the salesperson gets something they can act on.
export function blockedFromDemo(tag) {
  if (!tag) return "Tag not found.";
  if (!isMarketingStock(tag)) {
    return "This tag is not in field demo stock.";
  }
  if (tag.deletedAt) return "This tag has been deleted.";
  return null;
}

// Everything an activation writes onto the sticker. Deactivating clears exactly
// this set, so there is one list to keep right rather than one per call site.
// The vehicle fields and plate are the customer's and must not survive into the
// next person's demo.
export const DEMO_TAG_FIELDS = [
  "demoOwnerId",
  "demoOwnerCreated",
  "demoActivatedAt",
  "plateNumber",
  "vehicleLabel",
  "vehicleType",
  "emergencyContact",
  "freeContactUsed"
];

// May this account be deleted when the sticker is deactivated?
//
// ONLY accounts the demo itself created. Someone who already had a ParkTag
// account and activated a demo sticker with it keeps that account untouched —
// the sticker is simply detached from them.
//
// This deliberately ignores passwordHash. The real activation flow always sets
// one, so refusing to delete password-holding accounts would leave a real
// person's email, name and mobile behind after every single demo.
export function demoOwnerIsDisposable(owner, remainingTagCount) {
  if (!owner) return false;
  if (!owner.demoCreatedOwner) return false;
  return remainingTagCount === 0;
}

// How many physical stickers were printed carrying this one QR. Both copies
// resolve to the same token, so they are one tag with two bodies — and both
// must always go to the same person. Older records predate the field.
export function printedCopies(tag) {
  const n = Number(tag?.copiesPrinted);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

// Called from the real claim/activate routes once a tag has been attached to an
// owner. This is what makes the shelf notice an activation on its own: no
// pre-arming, no admin step before the customer scans.
//
// A no-op for every ordinary tag — it returns immediately unless the tag is
// field-demo stock — so the activation routes stay one narrow conditional
// heavier and nothing else about them changes.
export async function recordDemoActivation(collections, { tagId, ownerId, isNewOwner }) {
  const tag = await collections.tags.findOne({ _id: tagId });
  if (!isMarketingStock(tag) || isSold(tag)) return false;

  const now = new Date().toISOString();

  await collections.tags.updateOne(
    { _id: tagId, marketingStock: true },
    {
      $set: {
        demoOwnerId: ownerId,
        // Whether the wizard created this account for them, which decides
        // whether Deactivate may delete it again.
        demoOwnerCreated: Boolean(isNewOwner),
        demoActivatedAt: now,
        updatedAt: now
      },
      $inc: { demoCount: 1 }
    }
  );

  if (isNewOwner) {
    await collections.owners.updateOne({ _id: ownerId }, { $set: { demoCreatedOwner: true } });
  }

  return true;
}
