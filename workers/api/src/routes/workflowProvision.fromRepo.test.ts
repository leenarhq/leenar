import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { workflowProvision } from "./workflowProvision";

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return { ...actual, getUserToken: vi.fn().mockResolvedValue("token-test") };
});

const LOVABLE_ENV =
  "VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n";

const PKG = JSON.stringify({
  name: "my-lovable-app",
  dependencies: { react: "19", "@supabase/supabase-js": "2" },
  devDependencies: { vite: "5", "lovable-tagger": "1" },
});

/** Stubs every network call /from-repo makes. `ownedRefs` decides what the
 *  user's Supabase account reports back.
 *
 *  URLs below were read off the handler itself (workflowProvision.ts), not
 *  guessed: the repo-info + contents calls hit `api.github.com` directly,
 *  `fetchRepoFile` hits `raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`,
 *  and `listProjectRefs` hits the Supabase management API. A few raw-file
 *  probes (vite.config.ts body, the Lovable client file, supabase/config.toml)
 *  are made by the handler and by detectBuilder but are irrelevant to these
 *  two test cases, so they're deliberately left unstubbed and fall through to
 *  the 404 default below — that mirrors "file absent" in a real repo. Anything
 *  ELSE hitting the default is unexpected, so it's logged loudly instead of
 *  failing silently. */
function stubFetch(ownedRefs: string[]) {
  const EXPECTED_404_SUFFIXES = [
    "/main/vite.config.ts",
    "/main/src/integrations/supabase/client.ts",
    "/main/supabase/config.toml",
  ];
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/app")
      return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
    if (url === "https://api.github.com/repos/acme/app/contents/")
      return new Response(
        JSON.stringify([
          { name: "package.json", type: "file" },
          { name: "vite.config.ts", type: "file" },
          { name: ".env", type: "file" },
        ]),
        { status: 200 },
      );
    if (url.endsWith("/main/package.json")) return new Response(PKG, { status: 200 });
    if (url.endsWith("/main/.env")) return new Response(LOVABLE_ENV, { status: 200 });
    if (url === "https://api.supabase.com/v1/projects")
      return new Response(JSON.stringify(ownedRefs.map((id) => ({ id, name: id }))), {
        status: 200,
      });
    if (!EXPECTED_404_SUFFIXES.some((suffix) => url.endsWith(suffix))) {
      // eslint-disable-next-line no-console
      console.warn(`[stubFetch] unstubbed request, falling through to 404: ${url}`);
    }
    return new Response("Not found", { status: 404 });
  });
}

function app() {
  const a = new Hono<{ Bindings: any; Variables: { userId: string } }>();
  a.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  a.route("/api/projects", workflowProvision);
  return a;
}

// The handler's rate-limit check (provisioningHooks.rateLimit.check) goes
// straight to the RATE_LIMITER Durable Object binding, not through global
// fetch — so it needs its own fake DO namespace, same pattern as
// workflowProvision.integration.test.ts's makeEnv/makeRateLimiter.
function makeRateLimiter() {
  // A fresh Response per call — Response bodies can only be read once, and
  // this stub's `fetch` is invoked on every /from-repo request in this file.
  const stub = { fetch: vi.fn().mockImplementation(async () => Response.json({ allowed: true })) };
  return {
    idFromName: vi.fn().mockReturnValue("fake-id"),
    get: vi.fn().mockReturnValue(stub),
  };
}

const ENV = {
  INTERNAL_SECRET: "test-secret-at-least-32-characters!!",
  RATE_LIMITER: makeRateLimiter(),
} as never;

const call = () =>
  app().request(
    "/api/projects/from-repo",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl: "https://github.com/acme/app" }),
    },
    ENV,
  );

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("POST /from-repo — builder classification", () => {
  it("reports the builder and marks the backend as the user's when they own the ref", async () => {
    vi.stubGlobal("fetch", stubFetch(["abcdefghijklmnopqrst"]));
    const body = (await (await call()).json()) as {
      builder: {
        name: string;
        supabaseRef: string;
        envStyle: string;
        backendOwnership: string;
      };
      proposal: { services: Array<{ service_type: string; existing_ref: string | null }> };
    };

    expect(body.builder.name).toBe("lovable");
    expect(body.builder.supabaseRef).toBe("abcdefghijklmnopqrst");
    expect(body.builder.envStyle).toBe("env-file");
    expect(body.builder.backendOwnership).toBe("user");

    const supabase = body.proposal.services.find((s) => s.service_type === "supabase");
    expect(supabase).toBeDefined();
    expect(supabase!.existing_ref).toBe("abcdefghijklmnopqrst");
  });

  it("drops the supabase service when the backend is not the user's", async () => {
    vi.stubGlobal("fetch", stubFetch(["someotherrefaaaaaaaa"]));
    const body = (await (await call()).json()) as {
      builder: { backendOwnership: string; notMigrated: string[] };
      proposal: {
        services: Array<{ service_type: string }>;
        connections: Array<{ from_type: string; to_type: string }>;
      };
    };

    expect(body.builder.backendOwnership).toBe("external");
    expect(body.proposal.services.map((s) => s.service_type)).not.toContain("supabase");
    expect(
      body.proposal.connections.some(
        (c) => c.from_type === "supabase" || c.to_type === "supabase",
      ),
    ).toBe(false);
    expect(body.builder.notMigrated.length).toBeGreaterThan(0);
  });
});

describe("POST /from-repo — error surface", () => {
  it("still returns 400 with the original message for an unusable repo URL", async () => {
    // No fetch stub needed — parseGitHubUrl rejects this before any network call.
    vi.stubGlobal("fetch", vi.fn());
    const res = await app().request(
      "/api/projects/from-repo",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: "not-a-github-url" }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid GitHub repo URL");
  });

  it("does NOT surface an unexpected internal failure as a 400 with the raw message", async () => {
    // The GitHub root-info/contents fetch throws (network blip). This is not one
    // of analyzeRepo's two deliberate InvalidRepoUrlError cases, so it must NOT
    // be caught and flattened into a 400 — it should propagate past the route's
    // try/catch to whatever handles unhandled errors (in prod: appSetup.ts's
    // onError, which logs to Sentry and returns a generic 500). This bare test
    // app has no onError installed, so Hono's own default error handling is what
    // surfaces here — the point of the assertion is what it is NOT: a 400
    // carrying "network-blip-boom".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network-blip-boom");
      }),
    );
    const res = await call();
    expect(res.status).not.toBe(400);
    const text = await res.text();
    expect(text).not.toContain("network-blip-boom");
  });
});
