import { describe, it, expect } from "vitest";
import {
  EXTENSION_WHITELIST,
  EXTENSION_DESCRIPTIONS,
  assertWhitelistedExtension,
  buildEnableExtensionDDL,
  buildDisableExtensionDDL,
} from "./extensions";

describe("EXTENSION_WHITELIST", () => {
  it("is the closed set vector/pgcrypto/uuid-ossp/pg_trgm", () => {
    expect(EXTENSION_WHITELIST).toEqual([
      "vector",
      "pgcrypto",
      "uuid-ossp",
      "pg_trgm",
    ]);
  });

  it("has a description for every whitelist entry", () => {
    for (const name of EXTENSION_WHITELIST) {
      expect(typeof EXTENSION_DESCRIPTIONS[name]).toBe("string");
      expect(EXTENSION_DESCRIPTIONS[name].length).toBeGreaterThan(0);
    }
  });
});

describe("assertWhitelistedExtension", () => {
  it("passes silently for each whitelisted name", () => {
    for (const name of EXTENSION_WHITELIST) {
      expect(() => assertWhitelistedExtension(name)).not.toThrow();
    }
  });

  it("throws for a non-whitelisted but real extension (pg_cron)", () => {
    expect(() => assertWhitelistedExtension("pg_cron")).toThrow(
      /not allowed/i,
    );
  });

  it("throws for an empty string", () => {
    expect(() => assertWhitelistedExtension("")).toThrow(/not allowed/i);
  });

  it("throws for an arbitrary string", () => {
    expect(() => assertWhitelistedExtension("arbitrary")).toThrow(
      /not allowed/i,
    );
  });
});

describe("buildEnableExtensionDDL", () => {
  it("emits a quoted CREATE EXTENSION IF NOT EXISTS for a whitelisted name", () => {
    expect(buildEnableExtensionDDL("vector")).toBe(
      'CREATE EXTENSION IF NOT EXISTS "vector";',
    );
  });

  it("quotes hyphenated names like uuid-ossp", () => {
    expect(buildEnableExtensionDDL("uuid-ossp")).toBe(
      'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";',
    );
  });

  it("throws (does not build DDL) for a non-whitelisted name", () => {
    expect(() => buildEnableExtensionDDL("pg_cron")).toThrow(/not allowed/i);
  });
});

describe("buildDisableExtensionDDL", () => {
  it("emits a quoted DROP EXTENSION IF EXISTS for a whitelisted name", () => {
    expect(buildDisableExtensionDDL("pgcrypto")).toBe(
      'DROP EXTENSION IF EXISTS "pgcrypto";',
    );
  });

  it("quotes hyphenated names like uuid-ossp", () => {
    expect(buildDisableExtensionDDL("uuid-ossp")).toBe(
      'DROP EXTENSION IF EXISTS "uuid-ossp";',
    );
  });

  it("throws (does not build DDL) for a non-whitelisted name", () => {
    expect(() => buildDisableExtensionDDL("pg_cron")).toThrow(/not allowed/i);
  });
});
