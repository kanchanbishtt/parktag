import { getEnv } from "../lib/env.js";
import { seedDemoData } from "../lib/demo-data.js";
import { closeMongoConnection } from "../lib/mongo.js";

const env = getEnv();

try {
  const data = await seedDemoData(env);
  console.log(JSON.stringify({ ok: true, data }, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown seed error"
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  await closeMongoConnection();
}
