// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveTheme,
  readThemePref,
  writeThemePref,
  applyStoredTheme,
  setTheme,
} from "./theme";

// Node's own experimental `globalThis.localStorage` (active by default on
// recent Node) shadows jsdom's real implementation and throws without a
// --localstorage-file flag. Same workaround as GuideLayout.test.tsx: stub a
// plain in-memory Storage so these tests exercise real read/write behaviour
// regardless of which one the runtime handed us.
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

function mockPrefersLight(value: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("light") ? value : !value,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
}

describe("resolveTheme", () => {
  it("honours an explicit preference regardless of the OS", () => {
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
  });

  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("stored preference", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    document.documentElement.classList.remove("light");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to dark when nothing is stored", () => {
    expect(readThemePref()).toBe("dark");
  });

  it("round-trips system instead of deleting the key", () => {
    writeThemePref("system");
    expect(localStorage.getItem("leenar_theme")).toBe("system");
    expect(readThemePref()).toBe("system");
  });

  it("ignores a corrupt stored value", () => {
    localStorage.setItem("leenar_theme", "solarized");
    expect(readThemePref()).toBe("dark");
  });

  it("applyStoredTheme puts .light on the root only for a light result", () => {
    mockPrefersLight(false);
    writeThemePref("light");
    expect(applyStoredTheme()).toBe("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);

    writeThemePref("dark");
    expect(applyStoredTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("setTheme stores and applies in one call", () => {
    mockPrefersLight(true);
    expect(setTheme("system")).toBe("light");
    expect(localStorage.getItem("leenar_theme")).toBe("system");
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
