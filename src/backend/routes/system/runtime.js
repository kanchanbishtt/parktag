import { getMongoStatus } from "../../lib/db/mongo.js";

export function registerRuntimeRoutes(app, env) {
  app.get("/api/health", async () => {
    return {
      ok: true,
      service: "wavetag-backend",
      time: new Date().toISOString()
    };
  });

  // Unauthenticated by design (used for local/dev smoke checks), so it must
  // never leak infra details (ports, collection prefixes, integration
  // configuration, DB connectivity) to the public internet. Full detail is
  // only returned outside production; production gets an admin-gated view.
  app.get("/api/runtime/status", async (request, reply) => {
    if (env.runtimeMode === "production") {
      const { requireSession } = await import("../../lib/auth/auth.js");
      const blocked = await requireSession(app, "admin")(request, reply);
      if (blocked) return blocked;
    }

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
