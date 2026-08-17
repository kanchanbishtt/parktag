import crypto from "node:crypto";

// ── Shared (cross-replica) rate-limit store ────────────────────────────────
// @fastify/rate-limit defaults to an in-PROCESS store (an LRU in
// store/LocalStore.js). The wavetag service runs several replicas on Railway,
// and each one kept its own counter, so every declared limit was really
// `max × replicaCount` and requests scattered across replicas never
// accumulated anywhere. Measured against production: `/api/auth/forgot-password`
// is declared at 3/hour, yet six consecutive requests all returned 200 — each
// replica saw at most two of them. Ten requests forced down a single
// keep-alive connection (which Railway pins to one replica) decremented
// 199→190 perfectly, which is what proved the store, not the key, was at fault.
//
// The key itself is fine and is left alone: `trustProxy: 1` resolves
// `request.ip` to the real client address, and an injected `X-Forwarded-For`
// provably does NOT move the bucket, so limits are not spoofable.
//
// This store keeps counters in MongoDB, which every replica already shares.
//
// WHICH LIMITS GO TO MONGO
// The plugin only calls `child()` for routes that declare their own
// `config.rateLimit` (see index.js onRoute); routes without one use the root
// store instance directly. So the split falls out for free:
//   • root instance  → the coarse global 200/min guard, incl. every static
//     asset. Stays in memory: a DB write per asset request would be absurd,
//     and 200/min-per-replica is fine for what it is (a blunt flood guard).
//   • child instances → the ~31 sensitive routes (login, OTP, checkout,
//     password reset…). These are low-traffic and are the ones that must hold
//     across replicas, so they pay one round-trip.
//
// FAILURE BEHAVIOUR
// `skipOnError` defaults to false, meaning a store error propagates and turns
// a routine request into a 500 — so an Atlas blip would take down login. This
// store therefore NEVER reports an error: if Mongo is unreachable it silently
// falls back to its own in-memory counter. That degrades to the per-replica
// behaviour we have today rather than to no limiting at all, and never fails
// the request.
//
// NOT IMPLEMENTED: `continueExceeding` / `exponentialBackoff`. Neither is
// configured anywhere in this app; if one is ever switched on, teach the
// pipeline below about it rather than assuming it works.

// Bound on distinct keys held in memory, matching LocalStore's own default.
// Without a cap this is a memory-exhaustion vector: one key per client IP.
const MEMORY_KEY_CAP = 5000;

class MemoryCounters {
  constructor(cap = MEMORY_KEY_CAP) {
    this.cap = cap;
    this.entries = new Map();
  }

  hit(key, timeWindow) {
    const now = Date.now();
    const existing = this.entries.get(key);
    let entry;

    if (!existing || existing.resetAt <= now) {
      entry = { count: 1, resetAt: now + timeWindow };
    } else {
      entry = { count: existing.count + 1, resetAt: existing.resetAt };
      // Delete before re-inserting so Map iteration order stays
      // least-recently-used, which is what the eviction below relies on.
      this.entries.delete(key);
    }

    this.entries.set(key, entry);
    if (this.entries.size > this.cap) {
      this.evict(now);
    }

    return { current: entry.count, ttl: Math.max(entry.resetAt - now, 0) };
  }

  evict(now) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    // Still over budget once expired windows are gone: shed least-recent keys.
    while (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

class SharedRateLimitStore {
  // `namespace` null → this is the root instance (the global limiter), which
  // stays in memory. A non-null namespace means a per-route child backed by Mongo.
  constructor(deps, namespace = null) {
    this.deps = deps;
    this.namespace = namespace;
    this.memory = new MemoryCounters();
  }

  child(params) {
    const info = (params && params.routeInfo) || {};
    // Counters must be namespaced per route, otherwise every limited route
    // shares one bucket and the strictest limit silently governs them all.
    // (LocalStore gets this for free by handing each route its own LRU.)
    if (!info.url) {
      // Only reachable via the manual `fastify.rateLimit()` decorator, which
      // passes `routeInfo: {}` and so cannot be namespaced. Unused in this app;
      // fall back to memory rather than lumping such limiters into one bucket.
      return new SharedRateLimitStore(this.deps, null);
    }
    return new SharedRateLimitStore(this.deps, `${info.method || "*"} ${info.url}`);
  }

  incr(key, cb, timeWindow) {
    if (!this.namespace) {
      cb(null, this.memory.hit(key, timeWindow));
      return;
    }

    this.incrShared(key, timeWindow).then(
      (result) => cb(null, result),
      // incrShared already catches everything; this is a last-resort guard so
      // a bug in it can never surface as a 500 on a live auth route.
      () => cb(null, this.memory.hit(key, timeWindow))
    );
  }

  async incrShared(key, timeWindow) {
    let collection = null;
    try {
      collection = await this.deps.getCollection();
    } catch {
      collection = null;
    }

    // Mongo not configured (local dev) or unreachable — per-replica counting.
    if (!collection) return this.memory.hit(key, timeWindow);

    // The raw key is the client IP. Hash it, as the rest of the app already
    // does for scanner IPs (`hashIp` in security.js), so this collection never
    // becomes an incidental log of who visited what and when.
    const id = crypto
      .createHash("sha256")
      .update(`${this.namespace}|${key}`)
      .digest("hex");

    const startedAt = Date.now();

    try {
      // One atomic upsert: increment inside a live window, otherwise start a
      // fresh one. Done as an aggregation-pipeline update so the read and the
      // write cannot interleave — a read-modify-write here would undercount
      // exactly when it matters most, under a concurrent brute-force.
      //
      // `$$NOW` is the SERVER's clock, deliberately: replicas do not share a
      // clock, and comparing each replica's local time against a window
      // written by another would smear window boundaries.
      const windowAlive = {
        $gt: [{ $ifNull: ["$resetAt", "$$NOW"] }, "$$NOW"]
      };

      const result = await collection.findOneAndUpdate(
        { _id: id },
        [
          {
            $set: {
              count: {
                $cond: [windowAlive, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1]
              },
              resetAt: {
                $cond: [
                  windowAlive,
                  // On insert `$resetAt` is missing and `windowAlive` is false
                  // ($$NOW is not > $$NOW), so this branch is not taken then.
                  "$resetAt",
                  { $add: ["$$NOW", timeWindow] }
                ]
              }
            }
          }
        ],
        { upsert: true, returnDocument: "after" }
      );

      // Driver 6 returns the document directly; older drivers wrap it in
      // `{ value }`. Accept both so a driver bump can't quietly break limiting.
      const doc = result && result.value !== undefined ? result.value : result;

      if (!doc || typeof doc.count !== "number" || !doc.resetAt) {
        return this.memory.hit(key, timeWindow);
      }

      // Derived against the local clock only for the retry-after/reset header,
      // so a little skew is cosmetic. Clamped so a skewed replica can never
      // advertise a negative or absurdly long wait.
      const ttl = doc.resetAt.getTime() - Date.now();
      return { current: doc.count, ttl: Math.min(Math.max(ttl, 0), timeWindow) };
    } catch (error) {
      this.deps.log?.().warn?.(
        { err: error, namespace: this.namespace, tookMs: Date.now() - startedAt },
        "[rate-limit] shared store unavailable — falling back to per-replica counting"
      );
      return this.memory.hit(key, timeWindow);
    }
  }
}

// @fastify/rate-limit does `new Store(globalParams)`, so it needs a
// CONSTRUCTOR, not an instance. Return a class closed over the dependencies.
export function createSharedRateLimitStore(deps) {
  return class ConfiguredSharedRateLimitStore extends SharedRateLimitStore {
    constructor() {
      super(deps, null);
    }
  };
}
