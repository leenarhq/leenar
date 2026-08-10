import { describe, it, expect } from "vitest";
import { buildCreateDDLFromLiveSchema } from "./supabase";
import type { LiveSchema } from "./supabase";

describe("buildCreateDDLFromLiveSchema", () => {
  it("builds a full CREATE TABLE for a users table with real Postgres types, PK, RLS, and index replay", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "users",
          rlsEnabled: true,
          policies: [],
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              default: "gen_random_uuid()",
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "email",
              dataType: "text",
              nullable: false,
              default: null,
              isPrimaryKey: false,
              isUnique: true,
              isForeignKey: false,
            },
            {
              name: "age",
              dataType: "integer",
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "meta",
              dataType: "jsonb",
              nullable: true,
              default: "'{}'::jsonb",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "ip",
              dataType: "inet",
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [
            {
              name: "users_email_key",
              definition:
                'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)',
            },
            {
              name: "users_pkey",
              definition:
                'CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)',
            },
          ],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS public."users"');
    // headline: unknown/raw-SQL type preserved verbatim
    expect(ddl).toContain('"ip" inet');
    // nullable integer column: no NOT NULL
    expect(ddl).toMatch(/"age" integer(?! NOT NULL)/);
    expect(ddl).not.toMatch(/"age" integer NOT NULL/);
    // PK clause
    expect(ddl).toContain('PRIMARY KEY ("id")');
    // unique index replayed verbatim
    expect(ddl).toContain(
      'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);',
    );
    // pkey index NOT replayed (PRIMARY KEY clause already creates it)
    expect(ddl).not.toContain("users_pkey ON public.users");
    // RLS enabled
    expect(ddl).toContain(
      'ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;',
    );
    // email not null
    expect(ddl).toContain('"email" text NOT NULL');
    // jsonb default replayed
    expect(ddl).toContain("\"meta\" jsonb DEFAULT '{}'::jsonb");
  });

  it("does not emit ENABLE ROW LEVEL SECURITY when rlsEnabled is false", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "widgets",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              default: null,
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).not.toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("skips a nextval(...) default (sequence won't exist in the fresh clone)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "legacy",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "id",
              dataType: "integer",
              nullable: false,
              default: "nextval('legacy_id_seq'::regclass)",
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).not.toContain("DEFAULT nextval");
    expect(ddl).toContain('"id" integer NOT NULL');
  });

  it("replays gen_random_uuid(), now(), and cast literal defaults as-is", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              default: "gen_random_uuid()",
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "created_at",
              dataType: "timestamp with time zone",
              nullable: false,
              default: "now()",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "status",
              dataType: "text",
              nullable: false,
              default: "'active'::text",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid()');
    expect(ddl).toContain(
      '"created_at" timestamp with time zone NOT NULL DEFAULT now()',
    );
    expect(ddl).toContain("\"status\" text NOT NULL DEFAULT 'active'::text");
  });

  it("does not emit inline UNIQUE from isUnique (unique indexes already cover it)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "email",
              dataType: "text",
              nullable: false,
              default: null,
              isPrimaryKey: false,
              isUnique: true,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).not.toContain("UNIQUE");
  });

  it("returns empty string for an empty schema", () => {
    expect(buildCreateDDLFromLiveSchema({ tables: [] })).toBe("");
  });

  it("throws when a column dataType contains a semicolon (guard)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "x",
              dataType: "text; DROP TABLE users",
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    expect(() => buildCreateDDLFromLiveSchema(schema)).toThrow();
  });

  it("throws when a column dataType contains a newline (guard)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "x",
              dataType: "text\nDROP TABLE users",
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    expect(() => buildCreateDDLFromLiveSchema(schema)).toThrow();
  });

  it("ALLOWS a default containing '--' inside a string literal (not a SQL comment) — no false positive", () => {
    // In Postgres, '--' only starts a comment OUTSIDE a quoted string. A
    // legitimate column_default like '000--000'::text (SKUs, dates,
    // redaction markers) must survive the guard and be replayed verbatim.
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "sku",
              dataType: "text",
              nullable: false,
              default: "'000--000'::text",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).toContain("\"sku\" text NOT NULL DEFAULT '000--000'::text");
  });

  it("throws when a column default contains a newline (guard)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "x",
              dataType: "text",
              nullable: true,
              default: "'a'\nDROP TABLE users",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    expect(() => buildCreateDDLFromLiveSchema(schema)).toThrow();
  });

  it("throws when an index definition contains a semicolon mid-definition (guard)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "id",
              dataType: "uuid",
              nullable: false,
              default: null,
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [
            {
              name: "evil_idx",
              definition: "CREATE INDEX evil_idx ON t (id); DROP TABLE users",
            },
          ],
        },
      ],
    };

    expect(() => buildCreateDDLFromLiveSchema(schema)).toThrow();
  });

  it("emits no PRIMARY KEY clause for a table with no primary-key columns", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "events",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "payload",
              dataType: "jsonb",
              nullable: true,
              default: null,
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).not.toContain("PRIMARY KEY");
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS public."events"');
    expect(ddl).toContain('"payload" jsonb');
  });

  it("emits a composite PRIMARY KEY listing both columns in column order", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "membership",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "a",
              dataType: "uuid",
              nullable: false,
              default: null,
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
            {
              name: "b",
              dataType: "uuid",
              nullable: false,
              default: null,
              isPrimaryKey: true,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).toContain('PRIMARY KEY ("a", "b")');
  });

  it("replays a quoted-string default containing an apostrophe verbatim (passes narrowed guard)", () => {
    const schema: LiveSchema = {
      tables: [
        {
          name: "t",
          rlsEnabled: false,
          policies: [],
          columns: [
            {
              name: "note",
              dataType: "text",
              nullable: false,
              default: "'it''s a test'::text",
              isPrimaryKey: false,
              isUnique: false,
              isForeignKey: false,
            },
          ],
          indexes: [],
        },
      ],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).toContain("\"note\" text NOT NULL DEFAULT 'it''s a test'::text");
  });

  it("emits a syntactically valid zero-column CREATE TABLE (no dangling comma, no stray PRIMARY KEY)", () => {
    const schema: LiveSchema = {
      tables: [{ name: "t", rlsEnabled: false, columns: [], indexes: [], policies: [] }],
    };

    const ddl = buildCreateDDLFromLiveSchema(schema);
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS public."t"');
    expect(ddl).not.toContain("PRIMARY KEY");
    // no dangling comma before the closing paren
    expect(ddl).not.toMatch(/,\s*\)/);
  });
});
