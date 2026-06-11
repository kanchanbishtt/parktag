import { seedDemoData, getDemoCredentials } from "../lib/demo-data.js";

export function registerDemoRoutes(app, env) {
  app.get("/api/demo/credentials", async () => {
    return {
      ok: true,
      credentials: getDemoCredentials()
    };
  });

  app.post("/api/demo/seed", async (_request, reply) => {
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
  });
}
