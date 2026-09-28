// M3/M4: the indexes the admin, campaign and session-revoke queries rely on,
// and the memoised collection handles.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";

import { assertDisposableDatabase } from "./helpers.js";
import { getEnv } from "../lib/env.js";
import { getCollections, ensureCoreIndexes } from "../lib/db/repositories.js";
import { getMongoDb, closeMongoConnection } from "../lib/db/mongo.js";
import { createSession } from "../lib/auth/session.js";
import { BoundedTtlMap } from "../lib/bounded-map.js";

assertDisposableDatabase();

const env = getEnv();
let collections;

before(async () => {
  collections = await getCollections(env);
  await ensureCoreIndexes(collections, null);
});

after(async () => {
  await closeMongoConnection();
});

async function keysOf(name) {
  return (await collections[name].indexes()).map((ix) => JSON.stringify(ix.key));
}

test("the newest-first read paths are indexed", async () => {
  assert.ok((await keysOf("contactRequests")).includes(JSON.stringify({ createdAt: -1 })));
  assert.ok((await keysOf("owners")).includes(JSON.stringify({ createdAt: -1 })));
  assert.ok((await keysOf("shopOrders")).includes(JSON.stringify({ status: 1, createdAt: -1 })));
});

test("the trial-ending and session-revoke queries are indexed", async () => {
  assert.ok((await keysOf("tags")).includes(JSON.stringify({ premium: 1, status: 1, activatedAt: 1 })));
  assert.ok((await keysOf("sessions")).includes(JSON.stringify({ userId: 1 })));
});

test("the sessions TTL index exists once, however it was created", async () => {
  // session.js creates it lazily on the first login; the core list creates it
  // at boot. Same key and name, so there is still exactly one.
  await createSession(
    { sessions: new BoundedTtlMap({ cap: 10, ttlMs: 1000 }) },
    { id: "core-indexes-user", role: "owner", email: "core-indexes@parktag.test" }
  );
  const ttl = (await collections.sessions.indexes()).filter((ix) => ix.key.expiresAt === 1);
  assert.equal(ttl.length, 1);
  assert.equal(ttl[0].expireAfterSeconds, 0);
  await collections.sessions.deleteMany({ userId: "core-indexes-user" });
});

test("getCollections hands out one shared set per database", async () => {
  const again = await getCollections(env);
  assert.equal(again, collections);
  assert.equal(await getMongoDb(env), await getMongoDb(env));
});
