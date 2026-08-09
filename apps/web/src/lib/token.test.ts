import { describe, it, expect } from "vitest";
import { shouldRefreshToken } from "./token";

const NOW = 1_000_000_000_000; // fixed ms

describe("shouldRefreshToken", () => {
  it("refreshes when the token is already expired", () => {
    expect(shouldRefreshToken(NOW / 1000 - 10, NOW)).toBe(true);
  });
  it("refreshes when within the default 60s skew of expiry", () => {
    expect(shouldRefreshToken(NOW / 1000 + 30, NOW)).toBe(true);
  });
  it("does not refresh when comfortably valid", () => {
    expect(shouldRefreshToken(NOW / 1000 + 600, NOW)).toBe(false);
  });
  it("refreshes when expires_at is missing", () => {
    expect(shouldRefreshToken(undefined, NOW)).toBe(true);
  });
});
