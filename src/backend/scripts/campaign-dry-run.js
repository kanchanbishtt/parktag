// Rehearse every campaign against real data. Send nothing.
//
//   npm run campaigns:dry-run
//
// This is the step that stands between a wrong date comparison and the entire
// customer base being messaged in one tick. Run it after adding a campaign and
// after changing any query in one, pointed at production, and read the list.
//
// It is inert by construction rather than by intention: CAMPAIGN_DRY_RUN is
// forced on HERE, in the file, so the script cannot be made to send by getting
// an environment variable wrong. There is deliberately no flag to turn that
// off. If you want to send, let the scheduler send.
//
// What to look at in the output:
//
//   wouldSend far larger than you expected   a window has come unbounded
//   wouldSend 0 when you expect some         a type mismatch in the query, most
//                                            likely a Date compared against the
//                                            ISO strings this codebase stores
//   the same person under several campaigns  fine, but read it as a customer

process.env.CAMPAIGN_DRY_RUN = "1";

import { getEnv } from "../lib/env.js";
import { runTick } from "../lib/core/scheduler.js";
import { closeMongoConnection } from "../lib/db/mongo.js";

// A logger shaped like Fastify's, so the campaigns cannot tell the difference.
const log = {
  info: (obj, msg) => console.log(msg || "", JSON.stringify(obj, null, 2)),
  warn: (obj, msg) => console.warn(msg || "", JSON.stringify(obj, null, 2)),
  error: (obj, msg) => console.error(msg || "", JSON.stringify(obj, null, 2))
};

const env = getEnv();

console.log(`\nCampaign dry run against ${env.mongoCollectionPrefix || "(no prefix)"}\n`);

// `force` skips the lease. A dry run has no competitor worth serialising
// against and must not take a lease the live scheduler is waiting on.
const result = await runTick(env, log, { force: true });

if (!result.ran) {
  console.error(`\nDid not run: ${result.reason}\n`);
  await closeMongoConnection();
  process.exit(1);
}

console.log("\nSummary:");
for (const [campaign, outcome] of Object.entries(result.summary || {})) {
  const count = outcome?.wouldSend ?? outcome?.sent ?? 0;
  const note = outcome?.skipped ? ` (skipped: ${outcome.skipped})` : outcome?.error ? " (THREW)" : "";
  console.log(`  ${campaign.padEnd(24)} ${String(count).padStart(5)}${note}`);
}

console.log("\nNothing was sent.\n");

await closeMongoConnection();
