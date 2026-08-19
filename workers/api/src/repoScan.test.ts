import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectMonorepo,
  hasAppManifest,
  parseEnvKeys,
  pickEnvFile,
  summarizeRepo,
} from "./repoScan";

const RAW = "https://raw.githubusercontent.com/acme/app/main";

const PKG = JSON.stringify({
  name: "app",
  dependencies: { next: "15", "@supabase/supabase-js": "2" },
});

/** Mirrors GitHub's contents listing: every file entry carries a download_url
 *  already pointed at the default branch. That is the whole reason this scan
 *  costs one API call. */
function listing(names: string[]) {
  return names.map((name) => ({
    name,
    type: "file",
    download_url: `${RAW}/${name}`,
  }));
}

function stubFetch(files: Record<string, string>, names = Object.keys(files)) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://api.github.com/repos/acme/app/contents/")
      return new Response(JSON.stringify(listing(names)), { status: 200 });
    for (const [name, body] of Object.entries(files))
      if (url === `${RAW}/${name}`) return new Response(body, { status: 200 });
    return new Response("Not found", { status: 404 });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("pickEnvFile", () => {
  it("prefers the example file over the real one", () => {
    expect(pickEnvFile([".env", ".env.example"])).toBe(".env.example");
  });

  it("returns null when the root has no env file", () => {
    expect(pickEnvFile(["package.json"])).toBeNull();
  });
});

describe("parseEnvKeys", () => {
  it("takes the key from each assignment and skips comments", () => {
    expect(parseEnvKeys("# comment\nAPI_KEY=1\n\nDB_URL=postgres://x")).toEqual(
      ["API_KEY", "DB_URL"],
    );
  });

  it("rejects lowercase and dotted names", () => {
    expect(parseEnvKeys("api_key=1\nA.B=2")).toEqual([]);
  });
});

describe("hasAppManifest", () => {
  it("accepts a Python app, not only a Node one", () => {
    expect(hasAppManifest(["requirements.txt"])).toBe(true);
    expect(hasAppManifest(["package.json"])).toBe(true);
  });

  it("rejects a repo with only documents in the root", () => {
    expect(hasAppManifest(["README.md", "LICENSE"])).toBe(false);
  });
});

describe("detectMonorepo", () => {
  it("accepts a workspace file from any of the tools that use one", () => {
    for (const f of [
      "pnpm-workspace.yaml",
      "turbo.json",
      "lerna.json",
      "nx.json",
    ])
      expect(detectMonorepo([f, "package.json"], null)).toBe(true);
  });

  it("accepts package.json workspaces in both the array and the object form", () => {
    expect(detectMonorepo(["package.json"], { workspaces: ["apps/*"] })).toBe(
      true,
    );
    expect(
      detectMonorepo(["package.json"], {
        workspaces: { packages: ["apps/*"] },
      }),
    ).toBe(true);
  });

  it("does not call a declared-but-empty workspace a monorepo", () => {
    expect(detectMonorepo(["package.json"], { workspaces: [] })).toBe(false);
    expect(
      detectMonorepo(["package.json"], { workspaces: { packages: [] } }),
    ).toBe(false);
  });

  it("leaves an ordinary repo alone", () => {
    expect(
      detectMonorepo(["package.json", "next.config.mjs"], { name: "app" }),
    ).toBe(false);
    expect(detectMonorepo([], null)).toBe(false);
  });
});

describe("summarizeRepo", () => {
  it("says a workspace root is a monorepo, since it has no services to report", async () => {
    // The root package.json of a workspace declares tooling, not a stack, so
    // the chips come back empty. Without the flag that empty row reads as
    // "scanned, nothing found" — which is the opposite of what happened.
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "package.json": JSON.stringify({
          name: "monorepo",
          workspaces: ["apps/*", "packages/*"],
          devDependencies: { turbo: "2" },
        }),
      }),
    );

    const s = await summarizeRepo("acme/app", "tok");

    expect(s!.isMonorepo).toBe(true);
    expect(s!.services.filter((x) => x !== "github")).toEqual([]);
    // Still clickable: the proposal card resolves the real stack one click on.
    expect(s!.hasApp).toBe(true);
  });

  it("does not flag an ordinary app", async () => {
    vi.stubGlobal("fetch", stubFetch({ "package.json": PKG }));

    expect((await summarizeRepo("acme/app", "tok"))!.isMonorepo).toBe(false);
  });

  it("counts env keys from both the env file and the framework config", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        "package.json": PKG,
        ".env.example": "NEXT_PUBLIC_SUPABASE_URL=x\nAPI_KEY=y",
        "next.config.mjs":
          "export default { env: { S: process.env.SENTRY_DSN } }",
      }),
    );

    const s = await summarizeRepo("acme/app", "tok");

    // Two from the env file, one from the config, deduped.
    expect(s!.envKeys).toBe(3);
    expect(s!.hasApp).toBe(true);
    expect(s!.services).toContain("supabase");
    expect(s!.services).toContain("vercel");
  });

  it("spends exactly one GitHub API call", async () => {
    const f = stubFetch({ "package.json": PKG, ".env": "A=1" });
    vi.stubGlobal("fetch", f);

    await summarizeRepo("acme/app", "tok");

    const apiCalls = f.mock.calls.filter((c) =>
      String(c[0]).startsWith("https://api.github.com/"),
    );
    expect(apiCalls).toHaveLength(1);
  });

  it("reports no app when the root holds no manifest", async () => {
    vi.stubGlobal("fetch", stubFetch({}, ["README.md"]));

    const s = await summarizeRepo("acme/app", "tok");

    expect(s!.hasApp).toBe(false);
    expect(s!.envKeys).toBe(0);
  });

  it("returns null — not an empty summary — when GitHub will not answer", async () => {
    // A 502 must leave the cell plain and clickable, never dimmed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );

    expect(await summarizeRepo("acme/app", "tok")).toBeNull();
  });

  it("refuses a download_url that is not on raw.githubusercontent.com", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://api.github.com/repos/acme/app/contents/")
          return new Response(
            JSON.stringify([
              {
                name: "package.json",
                type: "file",
                download_url: "https://evil.example/package.json",
              },
            ]),
            { status: 200 },
          );
        throw new Error(`must not fetch ${url}`);
      }),
    );

    const s = await summarizeRepo("acme/app", "tok");

    expect(s!.services).toEqual(["github"]);
  });
});
