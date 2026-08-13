// ── Bounded, self-expiring in-process cache ────────────────────────────────
//
// A plain `Map` used as a cache is a memory leak whenever entries are removed
// on a path the caller may never take. Two such Maps existed:
//
//   • `app.oauthStates` — an entry is written by GET /api/auth/google and
//     deleted only by the OAuth CALLBACK. Every abandoned sign-in (user closes
//     the Google page, or an unauthenticated caller simply requests the route
//     in a loop) left an entry behind permanently. Measured: 141 bytes retained
//     per entry, never swept. The global limiter allows 200 req/min per IP,
//     i.e. ~288k entries/day ≈ 39 MB/day per IP, unbounded, until the container
//     is OOM-killed.
//
//   • `app.sessions` — a session is evicted only when someone READS it after it
//     has expired, so sessions belonging to users who never return are retained
//     for the life of the process.
//
// Both are caches in front of MongoDB (which already has TTL indexes), so
// dropping an entry early is always safe: the next read falls through to Mongo.
// That makes a hard cap the correct behaviour rather than a lossy compromise.
//
// This mirrors the cap already applied to rate-limit counters in
// lib/auth/rate-limit-store.js (MEMORY_KEY_CAP) — same reasoning, same shape.
//
// Sweeping is done lazily, on write, rather than with setInterval: a timer
// would keep the event loop alive and has to be tracked and cleared for tests
// and graceful shutdown. Insertion is the only moment the map can grow, so it
// is the only moment a sweep is needed.

export class BoundedTtlMap {
  // `ttlMs` — how long an entry may live. `cap` — hard ceiling on entries.
  constructor({ ttlMs, cap, name = "cache" } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("ttlMs must be a positive number");
    if (!Number.isFinite(cap) || cap <= 0) throw new Error("cap must be a positive number");
    this.ttlMs = ttlMs;
    this.cap = cap;
    this.name = name;
    this.entries = new Map();
    // Observability: without this a silent eviction storm looks like random
    // logouts / invalid_state errors and is very hard to diagnose in the field.
    this.evictedExpired = 0;
    this.evictedOverflow = 0;
  }

  get size() {
    return this.entries.size;
  }

  set(key, value, now = Date.now()) {
    // Delete before re-inserting so Map iteration order stays least-recently-
    // written, which is what the overflow eviction below relies on.
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    if (this.entries.size > this.cap) this.sweep(now);
    return this;
  }

  get(key, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key, now = Date.now()) {
    return this.get(key, now) !== undefined;
  }

  delete(key) {
    return this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }

  // Drop expired entries first; only if that is not enough, shed the
  // least-recently-written ones to get back under the cap.
  sweep(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        this.evictedExpired++;
      }
    }
    while (this.entries.size > this.cap) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
      this.evictedOverflow++;
    }
  }

  stats() {
    return {
      name: this.name,
      size: this.entries.size,
      cap: this.cap,
      ttlMs: this.ttlMs,
      evictedExpired: this.evictedExpired,
      evictedOverflow: this.evictedOverflow
    };
  }
}
