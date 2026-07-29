import { seedDemoData, getDemoCredentials } from "../../lib/demo-data.js";
import { isNonEmptyString, safeEqual } from "../../lib/auth/security.js";

export function registerDemoRoutes(app, env) {
  if (env.runtimeMode === "production") return;

  app.get("/api/demo/credentials", async () => {
    return {
      ok: true,
      credentials: getDemoCredentials()
    };
  });

  // Destructive (wipes owners/admins/tags/contact_requests, then reseeds a
  // well-known admin/owner login). It was protected ONLY by the
  // `runtimeMode !== "production"` check above — a single env-var string
  // comparison — and, when DEMO_SEED_SECRET was unset, the secret check below
  // was SKIPPED (fail-open). So a deployment that forgot APP_ENV=production and
  // had no DEMO_SEED_SECRET would expose a fully unauthenticated data wipe +
  // backdoor-admin creator.
  //
  // Now fail CLOSED: DEMO_SEED_SECRET must be configured AND supplied, as a
  // second layer independent of APP_ENV. Rate-limited too so it can't be
  // hammered.
  app.post(
    "/api/demo/seed",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      // No secret configured → seeding is disabled entirely. This is the
      // backstop for a mis-set APP_ENV: never allow the wipe without a secret.
      if (!isNonEmptyString(env.demoSeedSecret)) {
        reply.code(403);
        return {
          ok: false,
          error: "Demo seeding is disabled (set DEMO_SEED_SECRET to enable)."
        };
      }

      const supplied = (request.body || {}).secret;
      if (!isNonEmptyString(supplied) || !safeEqual(supplied, env.demoSeedSecret)) {
        reply.code(403);
        return { ok: false, error: "Forbidden" };
      }

      try {
        const data = await seedDemoData(env);

        return {
          ok: true,
          data
        };
      } catch (error) {
        reply.code(500);
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to seed demo data"
        };
      }
    }
  );
}
