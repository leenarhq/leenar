import { describe, it, expect } from "vitest";
import {
  serviceDrawerTabs,
  TAB_LABELS,
  type TabKey,
} from "./serviceDrawerTabs";

describe("serviceDrawerTabs", () => {
  it("vercel gets all four tabs in order", () => {
    expect(serviceDrawerTabs("vercel", true)).toEqual([
      "overview",
      "variables",
      "domains",
      "settings",
    ]);
  });

  it("supabase omits domains", () => {
    expect(serviceDrawerTabs("supabase", true)).toEqual([
      "overview",
      "variables",
      "settings",
    ]);
  });

  it("resend gets variables (keeps Env Overrides reachable) and domains", () => {
    expect(serviceDrawerTabs("resend", true)).toEqual([
      "overview",
      "variables",
      "domains",
      "settings",
    ]);
  });

  it("cloudflare omits domains", () => {
    expect(serviceDrawerTabs("cloudflare", true)).toEqual([
      "overview",
      "variables",
      "settings",
    ]);
  });

  it("unknown provider falls back to overview + settings", () => {
    expect(serviceDrawerTabs("github", true)).toEqual(["overview", "settings"]);
    expect(serviceDrawerTabs("", false)).toEqual(["overview", "settings"]);
  });

  it("tab visibility does not depend on isProvisioned", () => {
    expect(serviceDrawerTabs("vercel", false)).toEqual(
      serviceDrawerTabs("vercel", true),
    );
  });

  it("every TabKey has a label", () => {
    const keys: TabKey[] = ["overview", "variables", "domains", "settings"];
    for (const k of keys) expect(TAB_LABELS[k]).toBeTruthy();
  });
});
