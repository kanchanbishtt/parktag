// The reference a buyer quotes when something goes wrong.
//
// A date prefix plus a real, monotonically increasing sequence — PT-260728-00042
// — never a random blob, because this is the number a person reads down a phone
// line. The sequence comes from an atomic counter, so two checkouts completing
// in the same millisecond cannot be handed the same one.
//
// Shared by the shop and by memberships, off the SAME counter. Two generators
// would be two things to keep in step; two counters would mean PT-260902-00042
// existing twice, in different collections, which is precisely the moment
// support looks up the wrong order. One sequence spans every kind of order and
// a number identifies exactly one thing.

export async function generateOrderNumber(collections) {
  const now = new Date();
  const datePart =
    String(now.getFullYear()).slice(-2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");

  const res = await collections.counters.findOneAndUpdate(
    { _id: "shopOrder" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );

  // The v6 driver returns the doc directly; older behaviour wraps it in `.value`.
  const seq = (res && (res.seq ?? (res.value && res.value.seq))) || 1;
  return `PT-${datePart}-${String(seq).padStart(5, "0")}`;
}
