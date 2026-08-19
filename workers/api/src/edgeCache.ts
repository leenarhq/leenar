/**
 * A read-through cache on Cloudflare's edge cache, for values that are
 * expensive to derive and harmless a few minutes stale.
 *
 * Not KV, and this is a decision rather than a deferral. `caches.default`
 * needs no binding and no migration; the trade is that it is per-colo and
 * evictable, which only works because every miss here is safe.
 *
 * A KV tier was written and then reverted, so save the trip: the argument for
 * it is that a user landing on a different colo pays the scan twice, and that
 * user does not exist. Cloudflare routes to the nearest colo and keeps doing
 * so for the length of a session, the TTL here is ten minutes, and the repo
 * grid fires its batches concurrently — so they all land on the same colo by
 * construction. What KV would buy is a hit rate that is already ~1.
 *
 * The thing worth remembering instead: this cache, not the rate limiter, is
 * what bounds a user's GitHub spend. See routes/github.ts.
 *
 * Two rules the callers depend on:
 *   - the key lives on the caller's own origin, because Cloudflare rejects a
 *     cache.put() for a URL outside the worker's zone;
 *   - `null` is never cached, so a transient upstream failure does not stick
 *     around for the whole TTL.
 */
export async function cachedJson<T>(
  origin: string,
  key: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const cache = typeof caches === "undefined" ? null : caches.default;
  const req = new Request(`${origin}/__cache/${key}`);

  if (cache) {
    const hit = await cache.match(req).catch(() => undefined);
    if (hit) {
      const parsed = (await hit.json().catch(() => undefined)) as T | undefined;
      if (parsed !== undefined) return parsed;
    }
  }

  const value = await produce();

  if (cache && value !== null && value !== undefined) {
    await cache
      .put(
        req,
        new Response(JSON.stringify(value), {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${ttlSeconds}`,
          },
        }),
      )
      .catch(() => {});
  }

  return value;
}
