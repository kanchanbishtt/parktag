import { BoundedTtlMap } from "../bounded-map.js";

// A small read-through cache for results that are the same for everyone and
// expensive or rate-limited to fetch (a courier lookup, a maps lookup, a public
// price list). Built on BoundedTtlMap, so it is capped and self-expiring.
//
//   const cached = createLoaderCache({ ttlMs, cap, cacheable: (r) => r.ok });
//   const value = await cached(key, () => fetchTheThing(key));
//
// - Only results `cacheable` accepts are stored, so a failure or an "unknown"
//   answer is never remembered as if it were the real one.
// - Concurrent misses on one key share a single load.
// - `enabled: false` calls straight through. Callers switch it off outside
//   production so tests and local edits always see live data.
export function createLoaderCache({ ttlMs, cap = 500, name = "loader-cache", enabled = true, cacheable = () => true }) {
  const store = new BoundedTtlMap({ ttlMs, cap, name });
  const inflight = new Map();

  return function cached(key, load) {
    if (!enabled) return load();

    const hit = store.get(key);
    if (hit !== undefined) return Promise.resolve(hit);

    let pending = inflight.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(load)
        .then((value) => {
          if (value !== undefined && cacheable(value)) store.set(key, value);
          return value;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  };
}
