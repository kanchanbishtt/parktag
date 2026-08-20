import { buildApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { closeMongoConnection } from "./lib/db/mongo.js";
import { getCollections, ensureCoreIndexes } from "./lib/db/repositories.js";

const env = getEnv();
const app = await buildApp();

// Ordering matters, and it was backwards: Mongo was closed BEFORE the HTTP
// server, so every request still in flight when the platform sent SIGTERM lost
// its database mid-handler and failed. Railway sends SIGTERM on every deploy,
// so that was a burst of 500s on each release. `app.close()` stops accepting
// new connections and waits for in-flight requests to finish; only once they
// are done is it safe to drop the connection they depend on.
//
// `shutdown` is also guarded end-to-end. It is invoked from a signal handler,
// so an unhandled rejection here would terminate the process before the drain
// completed — turning a graceful shutdown back into an abrupt one.
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return; // a second SIGTERM must not race the first drain
  shuttingDown = true;

  app.log.info({ signal }, "Shutting down WaveTag backend");

  try {
    await app.close();          // 1. drain HTTP
  } catch (error) {
    app.log.error({ err: error }, "[shutdown] closing the HTTP server failed");
  }

  try {
    await closeMongoConnection(); // 2. then release the DB
  } catch (error) {
    app.log.error({ err: error }, "[shutdown] closing the Mongo connection failed");
  }

  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

// Node terminates the process on an unhandled rejection by default. Without a
// handler, one stray un-awaited promise anywhere in the app — a background
// send, a webhook side effect, a timer — takes the whole service down with no
// diagnostic beyond a bare stack trace. Log it with full context and keep
// serving: a rejected promise in one request must not evict every other user.
process.on("unhandledRejection", (reason, promise) => {
  app.log.error({ err: reason, promise: String(promise) }, "[process] unhandled promise rejection — service kept alive");
});

// An uncaught exception, by contrast, leaves the process in an unknown state,
// so the safe move is to drain and let the platform restart us rather than
// carry on with possibly-corrupt state.
process.on("uncaughtException", (error) => {
  app.log.fatal({ err: error }, "[process] uncaught exception — shutting down");
  shutdown("uncaughtException");
});

try {
  await app.listen({
    host: "0.0.0.0",
    port: env.port
  });
  console.log(`WaveTag server running at http://127.0.0.1:${env.port}`);
} catch (error) {
  app.log.error(error, "Failed to start WaveTag backend");
  process.exit(1);
}

// Create the indexes the hot query paths depend on (tags.token, owners.email /
// owners.mobile, the contact-request lookups, and TTLs on the collections that
// hold live secrets). Idempotent, backgrounded, and non-fatal: a failure here
// degrades performance but must never stop the service from starting.
//
// This runs AFTER listen and is deliberately not awaited. It used to sit above
// the listen call with an `await`, which made it neither backgrounded nor
// non-fatal in practice: with Mongo slow or unreachable, `getCollections` sits
// on the driver's server-selection timeout (~30s) before the catch is ever
// reached, so the port stayed closed and health checks failed the whole time.
// Boot must not depend on the database answering.
getCollections(env)
  .then((collections) => ensureCoreIndexes(collections, app.log))
  .catch((error) => {
    app.log.warn({ err: error }, "[indexes] core index setup skipped");
  });
