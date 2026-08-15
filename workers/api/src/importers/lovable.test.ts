import { describe, it, expect } from "vitest";
import { detectBuilder } from "./index";
import type { FetchRepoFile } from "./types";

const fetcherFor = (files: Record<string, string>): FetchRepoFile =>
  async (path) => files[path] ?? null;

describe("detectBuilder", () => {
  it("returns null when nothing signals a known builder", async () => {
    const hint = await detectBuilder(
      ["package.json", "next.config.js"],
      ["next", "react"],
      fetcherFor({}),
    );
    expect(hint).toBeNull();
  });

  it("does not call a bare Vite project Lovable", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts"],
      ["vite", "react"],
      fetcherFor({}),
    );
    expect(hint).toBeNull();
  });

  it("detects Lovable from the lovable-tagger dependency", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts", ".env"],
      ["react", "vite", "lovable-tagger"],
      fetcherFor({
        ".env": "VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n",
      }),
    );
    expect(hint).not.toBeNull();
    expect(hint!.builder).toBe("lovable");
    expect(hint!.framework).toBe("vite");
  });

  it("reads the Supabase ref out of a committed .env", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts", ".env"],
      ["lovable-tagger"],
      fetcherFor({
        ".env": "VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n",
      }),
    );
    expect(hint!.supabaseRef).toBe("abcdefghijklmnopqrst");
    expect(hint!.envStyle).toBe("env-file");
  });

  it("falls back to the hardcoded client when there is no .env", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts"],
      ["lovable-tagger"],
      fetcherFor({
        "src/integrations/supabase/client.ts":
          'const SUPABASE_URL = "https://zyxwvutsrqponmlkjihg.supabase.co";\n',
      }),
    );
    expect(hint!.supabaseRef).toBe("zyxwvutsrqponmlkjihg");
    expect(hint!.envStyle).toBe("hardcoded");
  });

  it("reports no ref rather than guessing when neither source has one", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts"],
      ["lovable-tagger"],
      fetcherFor({}),
    );
    expect(hint!.supabaseRef).toBeNull();
    expect(hint!.envStyle).toBe("unknown");
  });

  it("flags a supabase/config.toml when present", async () => {
    const hint = await detectBuilder(
      ["package.json", "vite.config.ts"],
      ["lovable-tagger"],
      fetcherFor({ "supabase/config.toml": 'project_id = "abcdefghijklmnopqrst"\n' }),
    );
    expect(hint!.hasSupabaseConfig).toBe(true);
  });
});
