import { describe, it, expect } from "vitest";
import { authSurfaceFor } from "./authSurface";

describe("authSurfaceFor", () => {
  it("enables every cloud-only surface, and leaves signup open", () => {
    expect(authSurfaceFor(true)).toEqual({
      oauth: true,
      magicLink: true,
      passwordReset: true,
      // Open since migration 077 dropped the invite trigger — the flag no
      // longer varies by build.
      inviteRequired: false,
    });
  });

  it("disables every cloud-only surface on a self-hosted core build", () => {
    expect(authSurfaceFor(false)).toEqual({
      oauth: false,
      magicLink: false,
      passwordReset: false,
      inviteRequired: false,
    });
  });

  it("returns a fresh object per call so callers cannot mutate shared state", () => {
    const a = authSurfaceFor(true);
    const b = authSurfaceFor(true);
    expect(a).not.toBe(b);
  });
});
