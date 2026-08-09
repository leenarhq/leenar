import { describe, it, expect } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { sameSession } from "./sessionEquality";

const mk = (accessToken: string, userId = "u1"): Session =>
  ({ access_token: accessToken, user: { id: userId } }) as unknown as Session;

describe("sameSession", () => {
  it("two nulls are equal (logged-out stays stable)", () => {
    expect(sameSession(null, null)).toBe(true);
  });

  it("null vs a session are different", () => {
    expect(sameSession(null, mk("a"))).toBe(false);
    expect(sameSession(mk("a"), null)).toBe(false);
  });

  it("same access token + same user => equal (re-emit is deduped)", () => {
    expect(sameSession(mk("tok-1"), mk("tok-1"))).toBe(true);
  });

  it("different access token => different (real refresh propagates)", () => {
    expect(sameSession(mk("tok-1"), mk("tok-2"))).toBe(false);
  });

  it("same token but different user => different (account switch propagates)", () => {
    expect(sameSession(mk("tok-1", "u1"), mk("tok-1", "u2"))).toBe(false);
  });
});
