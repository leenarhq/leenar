/**
 * A read-through cache on Cloudflare's edge cache, for values that are
 * expensive to derive and harmless a few minutes stale.
 *
 * Not KV, and not for want of trying: workers/api binds exactly one namespace
 * (IP_BLOCKS, wrangler.toml:33) and adding a second means running
 * `wrangler kv namespace create` against the real account — an operations
 * step, not a code change. `caches.default` needs no binding and no migration.
 * The trade is that it is per-colo and evictable, which only works because
 * every miss here is safe. KV remains the upgrade path if that stops being
 * true.
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
