import { buildApp } from "./app.js";
import { getEnv } from "./lib/env.js";
import { closeMongoConnection } from "./lib/mongo.js";

const env = getEnv();
const app = await buildApp();

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
