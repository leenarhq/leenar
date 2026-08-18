import { describe, it, expect, vi, afterEach } from "vitest";
import { cachedJson } from "./edgeCache";

/** A stand-in for caches.default: a Map keyed by request URL. */
function fakeCache() {
  const store = new Map<string, string>();
  return {
    store,
    match: vi.fn(async (req: Request) => {
      const body = store.get(req.url);
      return body === undefined ? undefined : new Response(body);
    }),
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, await res.text());
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cachedJson", () => {
  it("produces the value when nothing is cached, and stores it", async () => {
    const cache = fakeCache();
    vi.stubGlobal("caches", { default: cache });
    const produce = vi.fn(async () => ({ n: 1 }));

    expect(await cachedJson("https://api.test", "k", 60, produce)).toEqual({
      n: 1,
    });
    expect(produce).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
  });

  it("serves the second call from the cache without producing again", async () => {
    const cache = fakeCache();
    vi.stubGlobal("caches", { default: cache });
    const produce = vi.fn(async () => ({ n: 1 }));

    await cachedJson("https://api.test", "k", 60, produce);
    const second = await cachedJson("https://api.test", "k", 60, produce);

    expect(second).toEqual({ n: 1 });
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it("does not cache a null — a transient failure must not stick", async () => {
    const cache = fakeCache();
    vi.stubGlobal("caches", { default: cache });

    expect(
      await cachedJson("https://api.test", "k", 60, async () => null),
    ).toBeNull();
    expect(cache.store.size).toBe(0);
  });

  it("keeps the key on the caller's own origin", async () => {
    // Cloudflare rejects a cache.put() for a URL outside the worker's zone.
    const cache = fakeCache();
    vi.stubGlobal("caches", { default: cache });

    await cachedJson(
      "https://api.leenar.net",
      "repo-summary/v1/u1/acme%2Fapp",
      60,
      async () => 1,
    );

    expect([...cache.store.keys()][0]).toBe(
      "https://api.leenar.net/__cache/repo-summary/v1/u1/acme%2Fapp",
    );
  });

  it("still produces when there is no cache at all", async () => {
    // `caches` is undefined under vitest's node environment, and in any
    // runtime that is not a Cloudflare edge. A miss is always safe here.
    expect(await cachedJson("https://api.test", "k", 60, async () => 7)).toBe(7);
  });
});
