import { describe, it, expect, afterEach, vi } from "vitest";
import { isTabHidden } from "./visibility";

afterEach(() => vi.unstubAllGlobals());

describe("isTabHidden", () => {
  it("returns false when document is undefined (SSR-safe)", () => {
    vi.stubGlobal("document", undefined);
    expect(isTabHidden()).toBe(false);
  });
  it("reflects document.hidden", () => {
    vi.stubGlobal("document", { hidden: true } as unknown as Document);
    expect(isTabHidden()).toBe(true);
    vi.stubGlobal("document", { hidden: false } as unknown as Document);
    expect(isTabHidden()).toBe(false);
  });
});
