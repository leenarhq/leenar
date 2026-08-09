// Closed whitelist of Postgres extensions that can be enabled/disabled from
// the Database workspace's Extensions tab (Task 9). Primarily pgvector.
// This is a CLOSED set: assertWhitelistedExtension throws for anything not
// listed here BEFORE any DDL is built — both DDL builders route through it
// (defense-in-depth) so no caller can slip an arbitrary extension name
// through to CREATE/DROP EXTENSION.

export const EXTENSION_WHITELIST = [
  "vector",
  "pgcrypto",
  "uuid-ossp",
  "pg_trgm",
] as const;

export type WhitelistedExtension = (typeof EXTENSION_WHITELIST)[number];

export interface ExtensionInfo {
  name: string;
  installed: boolean;
  installedVersion: string | null;
  description: string;
}

// Static human descriptions, one per whitelist entry.
export const EXTENSION_DESCRIPTIONS: Record<WhitelistedExtension, string> = {
  vector: "pgvector — vector similarity search for AI embeddings / semantic search.",
  pgcrypto: "Cryptographic functions (gen_random_uuid, digest, hmac, crypt).",
  "uuid-ossp": "UUID generation functions (uuid_generate_v4, etc.).",
  pg_trgm: "Trigram matching for fuzzy text search and similarity.",
};

export function assertWhitelistedExtension(
  name: string,
): asserts name is WhitelistedExtension {
  if (!EXTENSION_WHITELIST.includes(name as WhitelistedExtension))
    throw new Error(`Extension not allowed: "${name}"`);
}

// Names are literals from a fixed whitelist, so no `qi` identifier-escaping
// helper is needed — but always emit double-quoted (required for
// "uuid-ossp"'s hyphen) and always route through assertWhitelistedExtension
// first, even though the quoting alone would already be safe.
export function buildEnableExtensionDDL(name: string): string {
  assertWhitelistedExtension(name);
  return `CREATE EXTENSION IF NOT EXISTS "${name}";`;
}

export function buildDisableExtensionDDL(name: string): string {
  assertWhitelistedExtension(name);
  return `DROP EXTENSION IF EXISTS "${name}";`;
}
