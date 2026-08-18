import { describe, it, expect } from "vitest";
import { daysUntil } from "./api";

describe("daysUntil", () => {
  it("is null when a token never expires", () => {
    expect(daysUntil(null)).toBeNull();
  });

  it("counts whole days forward", () => {
    const iso = new Date(Date.now() + 10 * 86_400_000).toISOString();
    expect(daysUntil(iso)).toBe(10);
  });

  // The reason this rounds up: a few milliseconds elapse between building
  // the deadline and reading the clock, and flooring turned "10 days" into
  // 9 every time. A countdown should not depend on that.
  it("rounds a part-day up so a countdown never loses a day", () => {
    const iso = new Date(Date.now() + 9.5 * 86_400_000).toISOString();
    expect(daysUntil(iso)).toBe(10);
  });

  it("is zero or negative once expired", () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(daysUntil(iso)).toBeLessThanOrEqual(0);
  });
});
