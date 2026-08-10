import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emit, redactPayload } from "./eventSourcing";
import type { Env } from "./types";

function makeEnv(): Env {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  } as unknown as Env;
}

describe("redactPayload", () => {
  it("redacts top-level keys matching secret patterns", () => {
    const result = redactPayload({
      supabase_service_role: "sbp_abcdef123456",
      r2_secret_access_key: "AKIAIOSFODNN7EXAMPLE",
      supabase_url: "https://proj.supabase.co",
    });

    expect(result.supabase_service_role).toBe("[REDACTED]");
    expect(result.r2_secret_access_key).toBe("[REDACTED]");
    expect(result.supabase_url).toBe("https://proj.supabase.co");
  });

  it("redacts common sensitive key patterns (password, token, private_key)", () => {
    const result = redactPayload({
      password: "hunter2",
      access_token: "gho_xxx",
      private_key: "-----BEGIN PRIVATE KEY-----",
      api_key: "abc123",
      username: "not-a-secret",
    });

    expect(result.password).toBe("[REDACTED]");
    expect(result.access_token).toBe("[REDACTED]");
    expect(result.private_key).toBe("[REDACTED]");
    expect(result.api_key).toBe("[REDACTED]");
    expect(result.username).toBe("not-a-secret");
  });

  it("recurses into nested objects", () => {
    const result = redactPayload({
      output: {
        supabase_service_role: "sbp_nested_secret",
        supabase_url: "https://proj.supabase.co",
        nested: {
          r2_secret_access_key: "deep-secret",
          note: "keep me",
        },
      },
    });

    const output = result.output as Record<string, unknown>;
    expect(output.supabase_service_role).toBe("[REDACTED]");
    expect(output.supabase_url).toBe("https://proj.supabase.co");
    const nested = output.nested as Record<string, unknown>;
    expect(nested.r2_secret_access_key).toBe("[REDACTED]");
    expect(nested.note).toBe("keep me");
  });

  it("recurses into arrays of objects", () => {
    const result = redactPayload({
      steps: [
        { name: "step1", service_role: "leak-1" },
        { name: "step2", service_role: "leak-2" },
      ],
    });

    const steps = result.steps as Array<Record<string, unknown>>;
    expect(steps[0].service_role).toBe("[REDACTED]");
    expect(steps[0].name).toBe("step1");
    expect(steps[1].service_role).toBe("[REDACTED]");
  });

  it("preserves keys — does not delete redacted fields", () => {
    const result = redactPayload({ secret_token: "xyz" });
    expect(Object.keys(result)).toContain("secret_token");
  });

  it("leaves non-object payloads untouched (null, arrays, primitives within array)", () => {
    const result = redactPayload({ list: [1, "two", null, true] });
    expect(result.list).toEqual([1, "two", null, true]);
  });

  it("handles empty payload", () => {
    expect(redactPayload({})).toEqual({});
  });
});

describe("emit", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("redacts secrets in payload before writing to provisioning_events", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await emit(makeEnv(), {
      sessionId: "session-1",
      stackId: "stack-1",
      type: "StepCompleted",
      payload: {
        output: {
          supabase_service_role: "sbp_super_secret",
          r2_secret_access_key: "AKIAEXAMPLE",
          supabase_url: "https://proj.supabase.co",
        },
      },
      idempotencyKey: "idem-1",
      sequence: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.payload.output.supabase_service_role).toBe("[REDACTED]");
    expect(body.payload.output.r2_secret_access_key).toBe("[REDACTED]");
    expect(body.payload.output.supabase_url).toBe("https://proj.supabase.co");
  });

  it("writes an empty payload object when opts.payload is omitted", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await emit(makeEnv(), {
      sessionId: "session-1",
      stackId: "stack-1",
      type: "SessionStarted",
      idempotencyKey: "idem-2",
      sequence: 0,
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.payload).toEqual({});
  });
});

describe('emit — non-2xx handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  const env = { SUPABASE_URL: 'https://s.test', SUPABASE_SERVICE_ROLE_KEY: 'k' } as any
  const base = { sessionId: 's', stackId: 'st', type: 'StepCompleted' as const, idempotencyKey: 's:StepCompleted:0', sequence: 1 }

  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves on a 2xx write', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    await expect(emit(env, base)).resolves.toBeUndefined()
  })

  it('resolves on 409 (idempotent replay — row already exists)', async () => {
    fetchMock.mockResolvedValue(new Response('duplicate key', { status: 409 }))
    await expect(emit(env, base)).resolves.toBeUndefined()
  })

  it('rejects on a 500 so durable callers can retry', async () => {
    fetchMock.mockResolvedValue(new Response('server error', { status: 500 }))
    await expect(emit(env, base)).rejects.toThrow()
  })
})
