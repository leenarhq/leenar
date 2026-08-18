import { describe, it, expect } from "vitest";
import { providerLabel } from "./providerMeta";

describe("providerLabel", () => {
  it("gives each known provider its human name", () => {
    expect(providerLabel("github")).toBe("GitHub");
    expect(providerLabel("vercel")).toBe("Vercel");
    expect(providerLabel("supabase")).toBe("Supabase");
    expect(providerLabel("resend")).toBe("Resend");
    expect(providerLabel("cloudflare")).toBe("Cloudflare");
  });

  it("is case-insensitive", () => {
    expect(providerLabel("GitHub")).toBe("GitHub");
    expect(providerLabel("SUPABASE")).toBe("Supabase");
  });

  it("falls back to the raw value for an unknown provider", () => {
    expect(providerLabel("planetscale")).toBe("planetscale");
    expect(providerLabel("")).toBe("service");
  });
});
