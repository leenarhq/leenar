// The rate-limit case lives in github.summary.ratelimit.test.ts, not here:
// provisioningHooks.rateLimit.check is a no-op in the core hooks, so a 429
// assertion cannot pass in the exported core repo, and vitest ships per file.
// Everything in THIS file is behaviour core has too, so it ships.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { github } from "./github";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, getUserToken: vi.fn().mockResolvedValue("token-test") };
});

const summarizeRepo = vi.fn();
vi.mock("../repoScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repoScan")>();
  return { ...actual, summarizeRepo: (...a: unknown[]) => summarizeRepo(...a) };
});

function app() {
  const a = new Hono<{ Bindings: any; Variables: { userId: string } }>();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.route("/api/github", github);
  return a;
}

// Same shape as workflowProvision.fromRepo.test.ts: the rate-limit check goes
// to the RATE_LIMITER Durable Object binding, not through global fetch.
function makeRateLimiter() {
  const stub = {
    fetch: vi.fn().mockImplementation(async () => Response.json({ allowed: true })),
  };
  return {
    idFromName: vi.fn().mockReturnValue("id"),
    get: vi.fn().mockReturnValue(stub),
  };
}

const env = () =>
  ({
    INTERNAL_SECRET: "test-secret-at-least-32-characters!!",
    RATE_LIMITER: makeRateLimiter(),
  }) as never;

const call = (body: unknown) =>
  app().request(
    "/api/github/repos/summary",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    env(),
  );

const summary = (full_name: string) => ({
  full_name,
  hasApp: true,
  envKeys: 3,
  services: ["github", "vercel"],
});

beforeEach(() => {
  summarizeRepo.mockReset();
  summarizeRepo.mockImplementation(async (full: string) => summary(full));
});

describe("POST /api/github/repos/summary", () => {
  it("returns a summary per requested repo, keyed by full name", async () => {
    const res = await call({ repos: ["acme/app", "acme/api"] });
    const body = (await res.json()) as { summaries: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(Object.keys(body.summaries).sort()).toEqual(["acme/api", "acme/app"]);
  });

  it("drops names that are not owner/repo instead of asking GitHub about them", async () => {
    await call({ repos: ["acme/app", "../../etc/passwd", "no-slash", "a/b/c"] });

    expect(summarizeRepo).toHaveBeenCalledTimes(1);
    expect(summarizeRepo).toHaveBeenCalledWith("acme/app", "token-test");
  });

  it("caps the batch at twenty", async () => {
    await call({ repos: Array.from({ length: 30 }, (_, i) => `acme/r${i}`) });

    expect(summarizeRepo).toHaveBeenCalledTimes(20);
  });

  it("omits a repo GitHub would not answer for rather than reporting it as appless", async () => {
    // F7: absent means "render the cell plain", hasApp:false means "dim it".
    summarizeRepo.mockImplementation(async (full: string) =>
      full === "acme/dead" ? null : summary(full),
    );

    const res = await call({ repos: ["acme/app", "acme/dead"] });
    const body = (await res.json()) as { summaries: Record<string, unknown> };

    expect(Object.keys(body.summaries)).toEqual(["acme/app"]);
  });

  it("survives one repo throwing", async () => {
    summarizeRepo.mockImplementation(async (full: string) => {
      if (full === "acme/boom") throw new Error("network");
      return summary(full);
    });

    const res = await call({ repos: ["acme/app", "acme/boom"] });
    const body = (await res.json()) as { summaries: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(Object.keys(body.summaries)).toEqual(["acme/app"]);
  });

  it("rejects a body with no repos array", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });
});
