// Error handling helpers that keep internal failures (database, DNS, network,
// third-party outages) from leaking to end users as raw messages.
//
// Only errors created with `clientError()` — i.e. deliberate, human-readable
// validation/business messages — are shown to the client. Everything else is
// logged server-side and replaced with a generic, meaningful fallback.

export class ClientError extends Error {
  constructor(message) {
    super(message);
    this.name = "ClientError";
    // Marks this message as safe to surface to the end user.
    this.expose = true;
  }
}

// Create an error whose message is intended for the end user.
export function clientError(message) {
  return new ClientError(message);
}

// Resolve the message to return to the client. Exposable errors pass through;
// anything else is logged and collapsed into `fallback` so internals stay hidden.
export function clientErrorMessage(error, fallback, logger) {
  if (error && error.expose === true && typeof error.message === "string") {
    return error.message;
  }

  if (logger && typeof logger.error === "function") {
    logger.error({ err: error }, `Internal error hidden from client: ${fallback}`);
  }

  return fallback;
}
