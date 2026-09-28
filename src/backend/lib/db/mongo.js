import { MongoClient } from "mongodb";
import dns from "node:dns";

let clientPromise = null;
let dnsPinned = false;

// Atlas uses mongodb+srv://, which needs a DNS SRV lookup. Some ISP resolvers
// (e.g. the secondary DNS handed out by certain routers) answer SRV queries
// with REFUSED, surfacing as "querySrv EREFUSED ..." and breaking connection.
// Pin Node's resolver to public DNS that reliably answers SRV, keeping any
// existing servers as fallback. Only relevant for +srv connection strings.
function pinReliableDnsForSrv(mongoUri) {
  if (dnsPinned || !mongoUri || !mongoUri.startsWith("mongodb+srv://")) {
    return;
  }

  const reliable = ["8.8.8.8", "1.1.1.1"];
  let existing = [];
  try {
    existing = dns.getServers();
  } catch {
    existing = [];
  }

  const ordered = [...reliable, ...existing.filter((s) => !reliable.includes(s))];

  try {
    dns.setServers(ordered);
    dnsPinned = true;
  } catch {
    // If the platform rejects setServers, fall back to system defaults.
  }
}

// The driver's default maxPoolSize is 100 and minPoolSize 0, and with
// maxIdleTimeMS at 60s an idle replica dropped every connection, so the next
// burst (say a wave of QR scans) paid connection setup on each request. Keep a
// couple warm and cap the pool well below Atlas's per-cluster connection limit.
const MAX_POOL_SIZE = 30;
const MIN_POOL_SIZE = 2;

function createClient(env) {
  return new MongoClient(env.mongoUri, {
    appName: "parktag-backend",
    maxPoolSize: MAX_POOL_SIZE,
    minPoolSize: MIN_POOL_SIZE,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    maxIdleTimeMS: 60000,
    retryWrites: true,
    retryReads: true
  });
}

export async function getMongoDb(env) {
  if (!env.mongoUri) {
    return null;
  }

  if (!clientPromise) {
    pinReliableDnsForSrv(env.mongoUri);
    const client = createClient(env);
    clientPromise = client.connect();
  }

  const client = await clientPromise;
  return dbFor(client, env.mongoDbName);
}

// client.db() builds a new Db object on every call. Handing out the same one per
// client and name is what lets getCollections() cache its handles on the Db.
const dbsByClient = new WeakMap();
function dbFor(client, name) {
  let byName = dbsByClient.get(client);
  if (!byName) {
    byName = new Map();
    dbsByClient.set(client, byName);
  }
  let db = byName.get(name);
  if (!db) {
    db = client.db(name);
    byName.set(name, db);
  }
  return db;
}

export async function getMongoStatus(env) {
  if (!env.mongoUri) {
    return {
      configured: false,
      connected: false
    };
  }

  try {
    const db = await getMongoDb(env);
    await db.command({ ping: 1 });

    return {
      configured: true,
      connected: true,
      database: env.mongoDbName
    };
  } catch (error) {
    // Never surface the raw driver error to callers of this status endpoint —
    // connection-string parse failures can echo the full mongoUri (including
    // the embedded username/password) back in error.message. Log it
    // server-side only and return a generic status to any API consumer.
    // eslint-disable-next-line no-console
    console.error("[mongo] connection check failed:", error);

    return {
      configured: true,
      connected: false,
      database: env.mongoDbName,
      error: "MongoDB connection failed"
    };
  }
}

export async function closeMongoConnection() {
  if (!clientPromise) {
    return;
  }

  const client = await clientPromise;
  clientPromise = null;
  await client.close();
}

// Used by operator actions that must archive and reset atomically.
export async function getMongoClient(env) {
  await getMongoDb(env);
  return clientPromise;
}
