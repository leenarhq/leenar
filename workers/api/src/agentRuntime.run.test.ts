import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub the tool dispatcher so these tests exercise the runAgent LOOP (multi-step
// orchestration, confirm gating, token accounting) without touching the DB.
// buildTools still needs the real TOOLS/whitelist, so keep the rest of the module.
const { callToolMock } = vi.hoisted(() => ({ callToolMock: vi.fn() }));
vi.mock("./routes/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/mcp")>();
  return { ...actual, callTool: callToolMock };
});

import { runAgent } from "./agentRuntime";
import type { Env } from "./types";

const env = { OPENAI_API_KEY: "sk-test" } as Env;

interface FakeToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** A fake OpenAI chat/completions response. */
function oai(opts: { content?: string | null; toolCalls?: FakeToolCall[] }): Response {
  const finish = opts.toolCalls?.length ? "tool_calls" : "stop";
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: opts.content ?? null, tool_calls: opts.toolCalls },
          finish_reason: finish,
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      model: "gpt-4o",
    }),
    { status: 200 },
  );
}

function tc(name: string, args: object, id = "call_1"): FakeToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("runAgent loop", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    callToolMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns the model's answer when it calls no tools", async () => {
    fetchMock.mockResolvedValueOnce(oai({ content: "Here is your status." }));
    const r = await runAgent({
      messages: [{ role: "user", content: "status?" }],
      userId: "u1",
      env,
      scope: "write",
    });
    expect(r.reply).toBe("Here is your status.");
    expect(r.actionsTaken).toEqual([]);
    expect(callToolMock).not.toHaveBeenCalled();
    expect(r.usage.inputTokens).toBe(10);
  });

  it("executes a tool then returns the final answer, summing tokens across steps", async () => {
    callToolMock.mockResolvedValueOnce({ workflows: [{ id: "p1" }] });
    fetchMock
      .mockResolvedValueOnce(oai({ toolCalls: [tc("list_workflows", {})] }))
      .mockResolvedValueOnce(oai({ content: "You have 1 workflow." }));

    const r = await runAgent({
      messages: [{ role: "user", content: "list my workflows" }],
      userId: "u1",
      env,
      scope: "write",
    });

    // 6th arg is the scope allowlist; undefined for write scope (all tools allowed).
    expect(callToolMock).toHaveBeenCalledWith("list_workflows", {}, "u1", env, "agent", undefined);
    expect(r.actionsTaken).toEqual([{ tool: "list_workflows", summary: "list_workflows" }]);
    expect(r.reply).toBe("You have 1 workflow.");
    expect(r.usage.inputTokens).toBe(20); // two OpenAI round-trips
    expect(r.usage.outputTokens).toBe(10);
  });

  it("strips a model-supplied confirm arg before dispatch (gate cannot be self-approved)", async () => {
    callToolMock.mockResolvedValueOnce({ confirmation_required: true });
    fetchMock
      .mockResolvedValueOnce(
        oai({ toolCalls: [tc("deploy_workflow", { project_id: "p1", confirm: true })] }),
      )
      .mockResolvedValueOnce(oai({ content: "Please confirm the deploy." }));

    const r = await runAgent({
      messages: [{ role: "user", content: "deploy p1" }],
      userId: "u1",
      env,
      scope: "write",
    });

    expect(callToolMock).toHaveBeenCalledTimes(1);
    const passedArgs = callToolMock.mock.calls[0][1] as Record<string, unknown>;
    expect(passedArgs).not.toHaveProperty("confirm");
    expect(passedArgs).toEqual({ project_id: "p1" });
    // Since the gate fired, this surfaces as a pending confirmation, not an action.
    expect(r.pendingConfirmation?.tool).toBe("deploy_workflow");
    expect(r.actionsTaken).toEqual([]);
  });

  it("keeps the FIRST pending confirmation when several destructive tools fire in one step", async () => {
    callToolMock
      .mockResolvedValueOnce({ confirmation_required: true })
      .mockResolvedValueOnce({ confirmation_required: true });
    fetchMock
      .mockResolvedValueOnce(
        oai({
          toolCalls: [
            tc("deploy_workflow", { project_id: "p1" }, "c1"),
            tc("delete_workflow", { project_id: "p2" }, "c2"),
          ],
        }),
      )
      .mockResolvedValueOnce(oai({ content: "Two actions need approval." }));

    const r = await runAgent({
      messages: [{ role: "user", content: "deploy p1 and delete p2" }],
      userId: "u1",
      env,
      scope: "write",
    });

    expect(r.pendingConfirmation?.tool).toBe("deploy_workflow");
    expect(r.actionsTaken).toEqual([]);
  });

  it("stops after MAX_STEPS instead of looping forever", async () => {
    callToolMock.mockResolvedValue({ ok: true });
    // Model keeps requesting tools every step; runAgent must bail at the cap.
    // Fresh Response per call — a Response body can only be read once.
    fetchMock.mockImplementation(async () =>
      oai({ toolCalls: [tc("get_canvas", { project_id: "p1" })] }),
    );

    const r = await runAgent({
      messages: [{ role: "user", content: "loop" }],
      userId: "u1",
      env,
      scope: "write",
    });

    // MAX_STEPS is 8 → at most 8 tool executions, then a fallback reply.
    expect(callToolMock.mock.calls.length).toBeLessThanOrEqual(8);
    expect(callToolMock.mock.calls.length).toBeGreaterThan(0);
    expect(r.reply.length).toBeGreaterThan(0);
  });

  it("returns a canvasUpdate diff after a canvas tool mutates the working canvas", async () => {
    callToolMock.mockImplementation(async (_name, _args, _uid, e) => {
      (e as Env)._workingCanvas!.nodes.push({
        id: "service-1",
        type: "service",
        data: { provider: "supabase", label: "Supabase" },
      });
      return { ok: true, node_id: "service-1" };
    });
    fetchMock
      .mockResolvedValueOnce(oai({ toolCalls: [tc("add_service", { project_id: "p1", provider: "supabase" })] }))
      .mockResolvedValueOnce(oai({ content: "Added Supabase." }));

    const r = await runAgent({
      messages: [{ role: "user", content: "add supabase" }],
      userId: "u1",
      env,
      scope: "canvas",
      workingCanvas: { nodes: [], edges: [] },
    });

    expect(r.canvasUpdate).toEqual({
      nodes: [{ type: "service", data: { provider: "supabase", label: "Supabase" } }],
      edges: [],
      update: [],
      remove: [],
      disconnect: [],
    });
    expect(r.canvasPending).toBeUndefined();
  });

  it("returns a destructive-only diff as canvasPending", async () => {
    callToolMock.mockImplementation(async (_name, _args, _uid, e) => {
      (e as Env)._workingCanvas!.nodes = [];
      return { ok: true };
    });
    fetchMock
      .mockResolvedValueOnce(oai({ toolCalls: [tc("remove_node", { project_id: "p1", node_id: "a" })] }))
      .mockResolvedValueOnce(oai({ content: "Removed it." }));

    const r = await runAgent({
      messages: [{ role: "user", content: "remove a" }],
      userId: "u1",
      env,
      scope: "canvas",
      workingCanvas: { nodes: [{ id: "a", type: "service", data: {} }], edges: [] },
    });

    expect(r.canvasPending?.remove).toEqual(["a"]);
    expect(r.canvasUpdate).toBeUndefined();
  });

  it("does not diff (no canvasUpdate) when no working canvas is supplied", async () => {
    callToolMock.mockResolvedValueOnce({ ok: true });
    fetchMock
      .mockResolvedValueOnce(oai({ toolCalls: [tc("get_canvas", { project_id: "p1" })] }))
      .mockResolvedValueOnce(oai({ content: "done" }));
    const r = await runAgent({
      messages: [{ role: "user", content: "x" }],
      userId: "u1",
      env,
      scope: "write",
    });
    expect(r.canvasUpdate).toBeUndefined();
    expect(r.canvasPending).toBeUndefined();
  });

  it("never seeds _workingCanvas outside canvas scope, even when workingCanvas is supplied", async () => {
    let sawWorkingCanvas: boolean | undefined;
    callToolMock.mockImplementation(async (_name, _args, _uid, e) => {
      sawWorkingCanvas = (e as Env)._workingCanvas !== undefined;
      return { ok: true };
    });
    fetchMock
      .mockResolvedValueOnce(oai({ toolCalls: [tc("get_canvas", { project_id: "p1" })] }))
      .mockResolvedValueOnce(oai({ content: "done" }));

    const r = await runAgent({
      messages: [{ role: "user", content: "x" }],
      userId: "u1",
      env,
      scope: "write",
      workingCanvas: { nodes: [{ id: "a", type: "service", data: {} }], edges: [] },
    });

    expect(sawWorkingCanvas).toBe(false);
    expect(r.canvasUpdate).toBeUndefined();
    expect(r.canvasPending).toBeUndefined();
  });
});
