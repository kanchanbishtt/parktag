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
  // well-known admin/owner login) and, until now, protected ONLY by the
  // `runtimeMode !== "production"` check above — a single env-var string
  // comparison. If a real deployment ever forgot to set APP_ENV=production,
  // this endpoint would be a fully unauthenticated, unrated-limited full
  // data wipe + backdoor-admin-account creator. Add a second, independent
  // layer: when DEMO_SEED_SECRET is configured, it must be supplied and
  // match. Rate-limited too so it can't be hammered.
  app.post(
    "/api/demo/seed",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (env.demoSeedSecret) {
        const supplied = (request.body || {}).secret;
        if (!isNonEmptyString(supplied) || !safeEqual(supplied, env.demoSeedSecret)) {
          reply.code(403);
          return { ok: false, error: "Forbidden" };
        }
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
