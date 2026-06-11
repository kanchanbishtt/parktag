import { getMongoStatus } from "../lib/mongo.js";

export function registerRuntimeRoutes(app, env) {
  app.get("/api/health", async () => {
    return {
      ok: true,
      service: "wavetag-backend",
      time: new Date().toISOString()
    };
  });

  app.get("/api/runtime/status", async () => {
    const mongo = await getMongoStatus(env);

    return {
      ok: true,
      stack: {
        backend: "Fastify",
        frontend: "HTML/CSS/JS",
        database: "MongoDB"
      },
      env: {
        port: env.port,
        runtimeMode: env.runtimeMode,
        mongoConfigured: Boolean(env.mongoUri),
        mongoDatabase: env.mongoDbName,
        mongoCollectionPrefix: env.mongoCollectionPrefix,
        exotelConfigured: Boolean(
          env.exotelAccountSid &&
            env.exotelApiKey &&
            env.exotelApiToken &&
            env.exotelCallerId
        ),
        metaWhatsappConfigured: Boolean(
          env.metaWhatsappPhoneNumberId && env.metaWhatsappAccessToken
        )
      },
      mongo
    };
  });
}
