import { describe, it, expect } from "vitest";
import { computeIsCloud } from "./cloud";

describe("computeIsCloud", () => {
  it("defaults to cloud when the flag is unset (regression-safe for prod)", () => {
    expect(computeIsCloud(undefined)).toBe(true);
  });
  it("stays cloud when explicitly 'true'", () => {
    expect(computeIsCloud("true")).toBe(true);
  });
  it("is core ONLY when explicitly 'false'", () => {
    expect(computeIsCloud("false")).toBe(false);
  });
  it("treats any other value as cloud (unset-like)", () => {
    expect(computeIsCloud("")).toBe(true);
    expect(computeIsCloud("0")).toBe(true);
  });
});
