/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

// Source read via import.meta.glob, not node:fs — workers/api's tsconfig ships
// no Node types on purpose; see tenancy.static.test.ts.
const SRC = (
  import.meta.glob("./chat.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>
)["./chat.ts"];

describe("GET /api/chat/usage under an unlimited quota", () => {
  it("short-circuits before querying ai_usage", () => {
    // The core edition has no ai_usage table: the query 404s (PGRST205) on
    // every poll. It is invisible in the worker log because the code treats a
    // failed fetch as "no rows", so it shows up only as noise in Postgres.
    expect(SRC).toMatch(/dailyUserMsgLimit\s*===\s*Number\.MAX_SAFE_INTEGER/);
  });

  it("reports unlimited to the client", () => {
    expect(SRC).toMatch(/unlimited:\s*true/);
  });
});
