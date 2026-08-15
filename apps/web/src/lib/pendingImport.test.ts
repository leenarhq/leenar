// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setPendingImport, takePendingImport } from "./pendingImport";

// Node's own experimental `globalThis.localStorage` (active by default on
// recent Node) shadows jsdom's real implementation and throws without a
// --localstorage-file flag. Stub a plain in-memory Storage so these tests
// exercise real read/write/remove behaviour regardless of which one the
// runtime handed us.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe("pendingImport", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing was ever set", () => {
    expect(takePendingImport()).toBeNull();
  });

  it("round-trips a builder name", () => {
    setPendingImport("lovable");
    expect(takePendingImport()).toBe("lovable");
  });

  it("is read-once: a second take returns null", () => {
    setPendingImport("lovable");
    takePendingImport();
    expect(takePendingImport()).toBeNull();
  });

  it("expires after the TTL", () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    setPendingImport("lovable");
    spy.mockReturnValue(now + 60 * 60 * 1000 + 1);
    expect(takePendingImport()).toBeNull();
    spy.mockRestore();
  });

  it("ignores an empty builder name", () => {
    setPendingImport("   ");
    expect(takePendingImport()).toBeNull();
  });
});
