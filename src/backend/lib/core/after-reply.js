// Work that belongs to a request but not to its reply.
//
// Placing a Cash on Delivery order used to answer the buyer only after the
// courier had booked the parcel, asked for a pickup, the WhatsApp confirmation
// had gone and the Meta conversion was sent: four providers, one after another,
// on the path a person was staring at. None of that changes what the reply
// says. The order exists the moment it is written, so that is when the buyer
// is told, and the rest runs on from here.
//
// `afterReply` starts `work` on the next turn of the event loop, so the handler
// returns and the reply is flushed first, and it never lets a failure escape:
// a courier outage after the order is placed is logged against the order, as
// bookCodShipment already does, not thrown into nowhere as an unhandled
// rejection.
//
// Every piece of work is tracked until it settles. That is for tests, which
// assert on what the work wrote and so need to wait for it (`settleAfterReply`),
// and for a graceful stop, so a process that is shutting down is not killed
// with a booking half-made.
const pending = new Set();

export function afterReply(log, label, work) {
  const run = new Promise((resolve) => setImmediate(resolve))
    .then(work)
    .catch((err) => {
      log?.error?.({ err, event: "after-reply-failed", label }, `[after-reply] ${label} failed`);
    })
    .finally(() => pending.delete(run));
  pending.add(run);
  return run;
}

// Resolves once everything handed to afterReply so far has finished, including
// work that was added while waiting.
export async function settleAfterReply() {
  while (pending.size) await Promise.all([...pending]);
}

export function pendingAfterReply() {
  return pending.size;
}
