import { buildApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { closeMongoConnection } from "./lib/db/mongo.js";
import { getCollections, ensureCoreIndexes } from "./lib/db/repositories.js";

const env = getEnv();
const app = await buildApp();

// Create the indexes the hot query paths depend on (tags.token, owners.email /
// owners.mobile, the contact-request lookups, and TTLs on the collections that
// hold live secrets). Idempotent, backgrounded, and non-fatal: a failure here
// degrades performance but must never stop the service from starting.
try {
  const collections = await getCollections(env);
  await ensureCoreIndexes(collections, app.log);
} catch (error) {
  app.log.warn({ err: error }, "[indexes] core index setup skipped");
}

async function shutdown(signal) {
  app.log.info({ signal }, "Shutting down WaveTag backend");

  await closeMongoConnection();
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
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
