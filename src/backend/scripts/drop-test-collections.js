// Drop the disposable test collections that accumulate on the shared cluster.
//
// WHY THIS EXISTS. Every test run works against a prefixed set of collections,
// and a one-off prefix (test_m132full_, test_scanui_, test_imgopt_ …) leaves a
// whole set behind forever. Atlas caps a cluster at 500 collections, and this
// one reached 493 — of which 380 were test leftovers against roughly 100 in
// real use across every other environment.
//
// That cap is not a tidiness problem. Once it is reached, ANY operation that
// would create a collection fails with AtlasError 8000, including the implicit
// creation Mongo does on a first write. It already broke fulfilment in the test
// environment: a paid order with a replaceTagId threw a 500 out of
// reassignVaultDocuments, which reads as a fulfilment bug and is not one. The
// same failure would reach a real customer the day a genuinely new collection
// is introduced in production.
//
//   node src/backend/scripts/drop-test-collections.js          # dry run
//   node src/backend/scripts/drop-test-collections.js --apply   # drop
//
// SAFETY. This only ever touches names beginning with test_ or ci_, matching
// the same rule assertDisposableDatabase uses to decide a prefix is throwaway.
// Every other prefix on the cluster — prod_, dev_, adm_, bp_, lk_, pq_, rpt_,
// qa_ — is refused by name, and an unprefixed collection is refused too. There
// is no flag to widen that: a script that can be talked into dropping
// production is worth less than one that cannot.

import { MongoClient } from "mongodb";

import { getEnv } from "../lib/env.js";

const apply = process.argv.includes("--apply");

// The one rule. Matches helpers.assertDisposableDatabase, deliberately — two
// different definitions of "disposable" is how one of them ends up wrong.
const DISPOSABLE = /^(test|ci)[_-]/i;

export function isDisposableCollection(name) {
  return DISPOSABLE.test(String(name || ""));
}

async function main() {
  const env = getEnv();
  if (!env.mongoUri) throw new Error("No MONGODB_URI.");

  const client = new MongoClient(env.mongoUri);
  await client.connect();

  try {
    const db = client.db(env.mongoDbName);
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);

    const disposable = names.filter(isDisposableCollection);
    const keep = names.filter((n) => !isDisposableCollection(n));

    // What is being kept, grouped, so it is obvious at a glance that nothing
    // real is in the drop list.
    const byPrefix = {};
    for (const n of keep) {
      const m = n.match(/^([a-z0-9]+_)/i);
      const k = m ? m[1] : "(no prefix)";
      byPrefix[k] = (byPrefix[k] || 0) + 1;
    }

    console.log("");
    console.log(`  database   ${env.mongoDbName}`);
    console.log(`  mode       ${apply ? "APPLY — will drop" : "dry run"}`);
    console.log(`  total      ${names.length} / 500`);
    console.log("");
    console.log(`  dropping   ${disposable.length}  (test_ / ci_)`);
    console.log(`  keeping    ${keep.length}`);
    for (const [k, v] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) {
      console.log(`               ${String(v).padStart(4)}  ${k}`);
    }
    console.log("");

    if (!disposable.length) {
      console.log("Nothing to drop.");
      return;
    }

    if (!apply) {
      console.log(`Dry run. Re-run with --apply to drop ${disposable.length} collection(s),`);
      console.log(`leaving ${keep.length} of 500.`);
      return;
    }

    let dropped = 0;
    const failed = [];

    for (const name of disposable) {
      // Belt and braces: re-check immediately before the drop, so a name can
      // never reach dropCollection without passing the rule.
      if (!isDisposableCollection(name)) {
        throw new Error(`Refusing to drop a non-disposable collection: ${name}`);
      }

      try {
        await db.dropCollection(name);
        dropped += 1;
      } catch (error) {
        failed.push(`${name}: ${error && error.message ? error.message : error}`);
      }
    }

    const after = (await db.listCollections({}, { nameOnly: true }).toArray()).length;
    console.log(`Dropped ${dropped}. Now ${after} / 500 — ${500 - after} free.`);
    for (const f of failed) console.log(`  ! ${f}`);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && process.argv[1].endsWith("drop-test-collections.js")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
