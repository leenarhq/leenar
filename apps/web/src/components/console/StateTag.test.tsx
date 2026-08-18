import { describe, it, expect } from "vitest";
import { toneFor } from "./StateTag";

describe("toneFor", () => {
  it("maps healthy states to ok", () => {
    for (const s of ["active", "live", "ready", "success", "provisioned"]) {
      expect(toneFor(s)).toBe("ok");
    }
  });

  it("maps degraded states to warn", () => {
    for (const s of ["drift", "degraded", "unverified", "pending"]) {
      expect(toneFor(s)).toBe("warn");
    }
  });

  it("maps failures to crit", () => {
    for (const s of ["error", "failed", "incident"]) {
      expect(toneFor(s)).toBe("crit");
    }
  });

  it("maps inert states to idle so they take no hue", () => {
    for (const s of ["draft", "rolled back", "cancelled", "unknown"]) {
      expect(toneFor(s)).toBe("idle");
    }
  });

  it("is case- and separator-insensitive", () => {
    expect(toneFor("ROLLED_BACK")).toBe("idle");
    expect(toneFor("Deploy Failed")).toBe("crit");
  });
});

describe("toneFor — dashboard vocabulary", () => {
  it("maps the up/down/unknown uptime statuses", () => {
    expect(toneFor("up")).toBe("ok");
    expect(toneFor("down")).toBe("crit");
    expect(toneFor("unknown")).toBe("idle");
  });

  it("maps the briefing and activity tones", () => {
    expect(toneFor("success")).toBe("ok");
    expect(toneFor("error")).toBe("crit");
    expect(toneFor("warning")).toBe("warn");
    expect(toneFor("neutral")).toBe("idle");
  });

  it("maps the vercel deploy states and the incident lifecycle", () => {
    // A build in flight is warn, not idle: it is a state you may need to wait
    // on. `resolved` closes an incident, so it is ok.
    expect(toneFor("BUILDING")).toBe("warn");
    expect(toneFor("READY")).toBe("ok");
    expect(toneFor("CANCELED")).toBe("idle");
    expect(toneFor("resolved")).toBe("ok");
    expect(toneFor("open")).toBe("idle");
    expect(toneFor("acknowledged")).toBe("idle");
  });

  it("maps the deployment statuses", () => {
    expect(toneFor("queued")).toBe("warn");
    expect(toneFor("cancelled")).toBe("idle");
    expect(toneFor("canceled")).toBe("idle");
    expect(toneFor("rolled_back")).toBe("idle");
  });

  it("maps the resource-health and alert-rule words", () => {
    expect(toneFor("alive")).toBe("ok");
    expect(toneFor("unreachable")).toBe("crit");
    expect(toneFor("on")).toBe("ok");
    expect(toneFor("off")).toBe("idle");
  });

  // The reason the exact table exists at all: a two-letter status cannot go
  // through the substring pass without matching half the provider names.
  it("does not let the short words leak into the substring pass", () => {
    expect(toneFor("supabase")).toBe("idle");
    expect(toneFor("backup")).toBe("idle");
    expect(toneFor("offline")).toBe("idle");
  });
});
