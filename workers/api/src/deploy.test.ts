import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────
const { mockClaimLock, mockReleaseLock } = vi.hoisted(() => ({
  mockClaimLock: vi.fn().mockResolvedValue({ ok: true }),
  mockReleaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./canvasVersion", () => ({
  claimLock: (...args: unknown[]) => mockClaimLock(...args),
  releaseLock: (...args: unknown[]) => mockReleaseLock(...args),
}));

// deployWorkflow pulls buildProvisionPlan/buildPreloadedCtx/CanvasSchema from
// the route module — stub the pieces deployWorkflow actually calls so these
// tests exercise claimDeploySlot wiring without dragging in the whole route.
const { mockBuildProvisionPlan, mockBuildPreloadedCtx } = vi.hoisted(() => ({
  mockBuildProvisionPlan: vi.fn().mockReturnValue({
    steps: [{ action: "provision", service: "vercel", nodeId: "n1" }],
    error: undefined,
  }),
  mockBuildPreloadedCtx: vi.fn().mockResolvedValue({}),
}));

vi.mock("./routes/workflowProvision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/workflowProvision")>();
  return {
    ...actual,
    buildProvisionPlan: (...args: unknown[]) => mockBuildProvisionPlan(...args),
    buildPreloadedCtx: (...args: unknown[]) => mockBuildPreloadedCtx(...args),
  };
});

import { claimDeploySlot, deployWorkflow } from "./deploy";

const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function makeEnv(extra: Record<string, unknown> = {}) {
  return {
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
    INTERNAL_SECRET: "test-secret-at-least-32-characters!!",
    ...extra,
  } as any;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  mockClaimLock.mockResolvedValue({ ok: true });
  mockReleaseLock.mockResolvedValue(undefined);
  mockBuildProvisionPlan.mockReturnValue({
    steps: [{ action: "provision", service: "vercel", nodeId: "n1" }],
    error: undefined,
  });
  mockBuildPreloadedCtx.mockResolvedValue({});
});

describe("claimDeploySlot", () => {
  it("returns 429 when the user has an active (running) provisioning stack", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("stacks?") && u.includes("status=eq.provisioning")) {
        return jsonResp([{ id: "stack-1", project_id: PROJECT_ID }]);
      }
      if (u.includes("provisioning_sessions")) {
        return jsonResp([
          { stack_id: "stack-1", status: "running", started_at: new Date().toISOString() },
        ]);
      }
      return jsonResp([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID);

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: "You already have an active deployment. Please wait for it to finish.",
    });
    expect(mockClaimLock).not.toHaveBeenCalled();
  });

  it("heals a stuck stack (terminal session) and proceeds to claim the lock", async () => {
    const STACK_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const patchCalls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("stacks?") && u.includes("status=eq.provisioning")) {
        return jsonResp([{ id: STACK_ID, project_id: PROJECT_ID }]);
      }
      if (u.includes("provisioning_sessions")) {
        return jsonResp([
          { stack_id: STACK_ID, status: "failed", started_at: new Date(Date.now() - 999999).toISOString() },
        ]);
      }
      if (u.includes("stacks?") && u.includes("id=in.") && init?.method === "PATCH") {
        patchCalls.push(u);
        return jsonResp([{}]);
      }
      return jsonResp([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID);

    expect(patchCalls.length).toBe(1);
    expect(mockReleaseLock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, USER_ID);
    expect(mockClaimLock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, USER_ID, "provisioning");
    expect(result).toEqual({ ok: true });
  });

  it("heals a stack whose session exceeded the DO timeout + buffer, even if still 'running'", async () => {
    const STACK_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const staleTime = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min ago
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("stacks?") && u.includes("status=eq.provisioning")) {
        return jsonResp([{ id: STACK_ID, project_id: PROJECT_ID }]);
      }
      if (u.includes("provisioning_sessions")) {
        return jsonResp([{ stack_id: STACK_ID, status: "running", started_at: staleTime }]);
      }
      if (u.includes("stacks?") && u.includes("id=in.") && init?.method === "PATCH") {
        return jsonResp([{}]);
      }
      return jsonResp([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID);
    expect(result).toEqual({ ok: true });
  });

  it("returns 423 when claimLock reports the canvas is already locked", async () => {
    mockClaimLock.mockResolvedValue({
      ok: false,
      lockedBy: "other-user",
      lockedAt: "2026-01-01T00:00:00Z",
    });
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp([])));

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID);

    expect(result).toEqual({
      ok: false,
      status: 423,
      error: "Workflow is currently being provisioned by another session.",
      lockedAt: "2026-01-01T00:00:00Z",
      lockedBy: "other-user",
    });
  });

  it("returns 503 when the underlying provisioning-stacks query itself fails (DB error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("db down", { status: 500 })),
    );

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID);

    expect(result).toEqual({
      ok: false,
      status: 503,
      error: "Service temporarily unavailable. Please try again.",
    });
    expect(mockClaimLock).not.toHaveBeenCalled();
  });

  it("skipLockClaim returns ok without calling claimLock", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResp([])));

    const result = await claimDeploySlot(makeEnv(), PROJECT_ID, USER_ID, {
      skipLockClaim: true,
    });

    expect(result).toEqual({ ok: true });
    expect(mockClaimLock).not.toHaveBeenCalled();
  });
});

describe("deployWorkflow", () => {
  function makeDeployFetch() {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("stacks?") && u.includes("status=eq.provisioning")) {
        return jsonResp([]); // no active stacks — claimDeploySlot proceeds to claimLock
      }
      if (u.includes("projects?") && u.includes("id=eq.")) {
        return jsonResp([
          {
            id: PROJECT_ID,
            name: "My Project",
            canvas: {
              nodes: [{ id: "n1", type: "service", data: { provider: "vercel" }, position: { x: 0, y: 0 } }],
              edges: [],
            },
          },
        ]);
      }
      if (u.includes("environments") || u.includes("default")) {
        return jsonResp([]);
      }
      if (u === "https://supabase.test/rest/v1/stacks" && init?.method === "POST") {
        return jsonResp([{ id: "new-stack-1" }]);
      }
      if (u.includes("stacks?") && u.includes("id=eq.new-stack-1") && init?.method === "PATCH") {
        return jsonResp([{}]);
      }
      return jsonResp([]);
    });
  }

  function makeDoNamespace(doOk: boolean) {
    const stub = {
      fetch: vi.fn().mockResolvedValue(
        doOk
          ? new Response(JSON.stringify({ ok: true, sessionId: "sess-1" }), { status: 200 })
          : new Response("do down", { status: 500 }),
      ),
    };
    return { idFromName: vi.fn().mockReturnValue("do-id"), get: vi.fn().mockReturnValue(stub) };
  }

  it("throws with status 429 when claimDeploySlot reports an active deployment, before touching the workflow", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("stacks?") && u.includes("status=eq.provisioning")) {
        return jsonResp([{ id: "stack-1", project_id: PROJECT_ID }]);
      }
      if (u.includes("provisioning_sessions")) {
        return jsonResp([{ stack_id: "stack-1", status: "running", started_at: new Date().toISOString() }]);
      }
      return jsonResp([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ PROVISIONER: makeDoNamespace(true) });

    await expect(deployWorkflow(PROJECT_ID, USER_ID, env)).rejects.toMatchObject({
      status: 429,
    });
    // Never got past the guard to fetch the workflow/project row.
    const projectFetches = fetchMock.mock.calls.filter(
      ([url]: [string]) => String(url).includes("projects?") && String(url).includes("id=eq."),
    );
    expect(projectFetches.length).toBe(0);
  });

  it("releases the lock when the DO fails to start (lock claimed but never handed off)", async () => {
    const fetchMock = makeDeployFetch();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ PROVISIONER: makeDoNamespace(false) });

    await expect(deployWorkflow(PROJECT_ID, USER_ID, env)).rejects.toThrow(
      /ProvisionerDO start failed/,
    );

    expect(mockClaimLock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, USER_ID, "provisioning");
    expect(mockReleaseLock).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, USER_ID);
  });

  it("does not release the lock on the success path (the DO owns release from here)", async () => {
    const fetchMock = makeDeployFetch();
    vi.stubGlobal("fetch", fetchMock);
    const env = makeEnv({ PROVISIONER: makeDoNamespace(true) });

    const result = await deployWorkflow(PROJECT_ID, USER_ID, env);

    expect(result.ok).toBe(true);
    expect(mockReleaseLock).not.toHaveBeenCalled();
  });
});
