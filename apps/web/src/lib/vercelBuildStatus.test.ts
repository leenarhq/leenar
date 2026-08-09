import { describe, it, expect } from "vitest";
import {
  mapReadyState,
  isPollDone,
  VERCEL_BUILD_POLL_MS,
  VERCEL_BUILD_MAX_ATTEMPTS,
} from "./vercelBuildStatus";

describe("mapReadyState", () => {
  it("maps READY to ready", () => {
    expect(mapReadyState("READY")).toBe("ready");
  });
  it("maps BUILDING/QUEUED/INITIALIZING to building", () => {
    expect(mapReadyState("BUILDING")).toBe("building");
    expect(mapReadyState("QUEUED")).toBe("building");
    expect(mapReadyState("INITIALIZING")).toBe("building");
  });
  it("maps ERROR and CANCELED to error", () => {
    expect(mapReadyState("ERROR")).toBe("error");
    expect(mapReadyState("CANCELED")).toBe("error");
  });
  it("maps unknown/absent values to unknown", () => {
    expect(mapReadyState("UNKNOWN")).toBe("unknown");
    expect(mapReadyState("")).toBe("unknown");
    expect(mapReadyState("WAT")).toBe("unknown");
  });
});

describe("isPollDone", () => {
  it("stops on ready and error", () => {
    expect(isPollDone("ready")).toBe(true);
    expect(isPollDone("error")).toBe(true);
  });
  it("keeps polling on building and unknown", () => {
    expect(isPollDone("building")).toBe(false);
    expect(isPollDone("unknown")).toBe(false);
  });
});

describe("poll constants", () => {
  it("polls every ~4s up to ~5min", () => {
    expect(VERCEL_BUILD_POLL_MS).toBe(4000);
    expect(VERCEL_BUILD_MAX_ATTEMPTS).toBe(75);
  });
});
