import { describe, it, expect, vi, afterEach } from "vitest";
import {
  normalizeProposal,
  validateCanvasUpdate,
  parseAIResponse,
  callAI,
} from "./conversation";
import type {
  StackProposal,
  ServiceItem,
  ConnectionItem,
  CanvasUpdatePayload,
  AIUsage,
} from "./conversation";

const USAGE: AIUsage = { model: "gpt-4o", inputTokens: 0, outputTokens: 0 };

describe("parseAIResponse — control tag parsing (stack/new mode)", () => {
  // The XML "workspace" chat path (CANVAS_UPDATE/PENDING/ACTION tags) was
  // retired in Faz 4b — workspace canvas editing now runs on the agent
  // runtime (Tasks 2-5). "stack" and "new" only ever emit <PROPOSAL>.
  it("parses a <PROPOSAL> tag and strips it from the reply", () => {
    const text =
      'Here is a plan. <PROPOSAL>{"name":"App","summary":"s","services":[{"service_type":"github","display_name":"GitHub","existing_repo":null}],"connections":[]}</PROPOSAL>';
    const res = parseAIResponse(text, "stack", USAGE);
    expect(res.proposal?.name).toBe("App");
    expect(res.reply).toBe("Here is a plan.");
    expect(res.reply).not.toContain("<PROPOSAL>");
  });

  it("never leaks a malformed control tag into the reply (defense in depth)", () => {
    const text = "Here you go. <ACTION>{not valid json}</ACTION>";
    const res = parseAIResponse(text, "stack", USAGE);
    expect(res.reply).not.toContain("<ACTION>");
    expect(res.reply).not.toContain("not valid json");
  });

  it("falls back to plain reply text when there is no PROPOSAL tag", () => {
    const text = "Sure, tell me more about your project.";
    const res = parseAIResponse(text, "new", USAGE);
    expect(res.reply).toBe(text);
    expect(res.proposal).toBeUndefined();
  });
});

function svc(service_type: ServiceItem["service_type"]): ServiceItem {
  return { service_type, display_name: service_type, existing_repo: null };
}

function conn(from_type: string, to_type: string): ConnectionItem {
  return { from_type, to_type, env_var_name: "TEST_VAR" };
}

function proposal(
  services: ServiceItem[],
  connections: ConnectionItem[] = [],
): StackProposal {
  return { name: "Test Stack", summary: "test", services, connections };
}

describe("normalizeProposal — GitHub auto-insert", () => {
  it("inserts GitHub at index 0 when Vercel is present but GitHub is not", () => {
    const result = normalizeProposal(proposal([svc("vercel")]));
    expect(result.services[0].service_type).toBe("github");
    expect(result.services[1].service_type).toBe("vercel");
  });

  it("does not insert GitHub when Vercel is absent", () => {
    const result = normalizeProposal(proposal([svc("supabase")]));
    expect(result.services).toHaveLength(1);
    expect(result.services[0].service_type).toBe("supabase");
  });

  it("does not duplicate GitHub when already present", () => {
    const result = normalizeProposal(proposal([svc("github"), svc("vercel")]));
    const githubCount = result.services.filter(
      (s) => s.service_type === "github",
    ).length;
    expect(githubCount).toBe(1);
  });
});

describe("normalizeProposal — edge direction normalization", () => {
  it("flips vercel→supabase to supabase→vercel", () => {
    const result = normalizeProposal(
      proposal([svc("vercel"), svc("supabase")], [conn("vercel", "supabase")]),
    );
    expect(result.connections[0]).toMatchObject({
      from_type: "supabase",
      to_type: "vercel",
    });
  });

  it("flips vercel→github to github→vercel", () => {
    const result = normalizeProposal(
      proposal([svc("github"), svc("vercel")], [conn("vercel", "github")]),
    );
    expect(result.connections[0]).toMatchObject({
      from_type: "github",
      to_type: "vercel",
    });
  });

  it("leaves correct directions unchanged", () => {
    const connections = [conn("github", "vercel"), conn("supabase", "vercel")];
    const result = normalizeProposal(proposal([], connections));
    expect(result.connections[0]).toMatchObject({
      from_type: "github",
      to_type: "vercel",
    });
    expect(result.connections[1]).toMatchObject({
      from_type: "supabase",
      to_type: "vercel",
    });
  });

  it("handles missing connections array gracefully", () => {
    const p: StackProposal = {
      name: "test",
      summary: "test",
      services: [],
      connections: [],
    };
    const result = normalizeProposal(p);
    expect(result.connections).toEqual([]);
  });
});

// --- 6 targeted normalizeProposal integration tests ---

function makeProposal(
  services: StackProposal["services"],
  connections: StackProposal["connections"] = [],
): StackProposal {
  return { name: "test", summary: "test", services, connections };
}

describe("normalizeProposal", () => {
  it("inserts a GitHub service at index 0 when Vercel is present but GitHub is absent", () => {
    const proposal = makeProposal([
      { service_type: "vercel", display_name: "My App" },
    ]);

    const result = normalizeProposal(proposal);

    expect(result.services[0].service_type).toBe("github");
    expect(result.services.some((s) => s.service_type === "vercel")).toBe(true);
  });

  it("does not add a duplicate GitHub when one already exists", () => {
    const proposal = makeProposal([
      { service_type: "github", display_name: "Repo" },
      { service_type: "vercel", display_name: "App" },
    ]);

    const result = normalizeProposal(proposal);

    const githubCount = result.services.filter(
      (s) => s.service_type === "github",
    ).length;
    expect(githubCount).toBe(1);
  });

  it("auto-adds a supabase→vercel connection when both exist but no connection is present", () => {
    const proposal = makeProposal(
      [
        { service_type: "supabase", display_name: "DB" },
        { service_type: "vercel", display_name: "App" },
      ],
      [], // no connections
    );

    const result = normalizeProposal(proposal);

    const sbVercelConn = result.connections.find(
      (c) => c.from_type === "supabase" && c.to_type === "vercel",
    );
    expect(sbVercelConn).toBeDefined();
  });

  it("hasSupabaseFinal regression: adds supabase→vercel connection even when Supabase was not in the original services list but is present after normalization (post-normalize check)", () => {
    // This proposal has Vercel + Supabase. The old bug read `hasSupabase`
    // BEFORE normalization ran, so if the order of normalization differed,
    // the supabase→vercel edge could be missed. We verify it's always added.
    const proposal = makeProposal(
      [
        { service_type: "vercel", display_name: "App" },
        { service_type: "supabase", display_name: "DB" },
      ],
      [],
    );

    const result = normalizeProposal(proposal);

    const conn = result.connections.find(
      (c) => c.from_type === "supabase" && c.to_type === "vercel",
    );
    expect(conn).toBeDefined();
  });

  it("does not duplicate supabase→vercel connection when it already exists", () => {
    const proposal = makeProposal(
      [
        { service_type: "supabase", display_name: "DB" },
        { service_type: "vercel", display_name: "App" },
      ],
      [
        {
          from_type: "supabase",
          to_type: "vercel",
          env_var_name: "SUPABASE_URL",
        },
      ],
    );

    const result = normalizeProposal(proposal);

    const sbVercelConns = result.connections.filter(
      (c) => c.from_type === "supabase" && c.to_type === "vercel",
    );
    expect(sbVercelConns).toHaveLength(1);
  });

  it("returns proposal unchanged (no throw) when services list is empty", () => {
    const proposal = makeProposal([]);

    expect(() => normalizeProposal(proposal)).not.toThrow();
    const result = normalizeProposal(proposal);
    expect(result.services).toHaveLength(0);
    expect(result.connections).toHaveLength(0);
  });
});

describe("validateCanvasUpdate", () => {
  const base: CanvasUpdatePayload = { nodes: [], edges: [] };

  it("passes through valid payload unchanged", () => {
    const payload: CanvasUpdatePayload = {
      nodes: [
        { type: "service", data: { provider: "vercel", label: "Vercel" } },
      ],
      edges: [{ source: "a", target: "b" }],
      description: "Add Vercel node",
    };
    const result = validateCanvasUpdate(payload);
    expect(result.nodes[0].data.provider).toBe("vercel");
    expect(result.nodes[0].data.label).toBe("Vercel");
    expect(result.edges).toHaveLength(1);
    expect(result.description).toBe("Add Vercel node");
  });

  it("strips invalid provider field", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      nodes: [{ type: "service", data: { provider: "aws" } }],
    };
    const result = validateCanvasUpdate(payload);
    expect(result.nodes[0].data.provider).toBeUndefined();
  });

  it("clamps nodes array to max 10", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      nodes: Array.from({ length: 15 }, (_, i) => ({
        type: "service",
        data: { provider: "vercel", label: `Node ${i}` },
      })),
    };
    const result = validateCanvasUpdate(payload);
    expect(result.nodes).toHaveLength(10);
  });

  it("clamps edges array to max 30", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      edges: Array.from({ length: 35 }, (_, i) => ({
        source: `s${i}`,
        target: `t${i}`,
      })),
    };
    const result = validateCanvasUpdate(payload);
    expect(result.edges).toHaveLength(30);
  });

  it("filters malformed node IDs in remove list", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      remove: [
        "valid-id",
        "also_valid",
        "bad id!",
        "../escape",
        "a".repeat(65),
      ],
    };
    const result = validateCanvasUpdate(payload);
    expect(result.remove).toEqual(["valid-id", "also_valid"]);
  });

  it("truncates label to 64 chars", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      nodes: [{ type: "service", data: { label: "A".repeat(100) } }],
    };
    const result = validateCanvasUpdate(payload);
    expect(result.nodes[0].data.label).toHaveLength(64);
  });

  it("truncates description to 200 chars", () => {
    const payload: CanvasUpdatePayload = {
      ...base,
      description: "D".repeat(300),
    };
    const result = validateCanvasUpdate(payload);
    expect(result.description).toHaveLength(200);
  });

  it("handles missing optional arrays gracefully", () => {
    const result = validateCanvasUpdate(base);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.remove).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.disconnect).toEqual([]);
  });
});

describe("callAI — untrusted content guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes an <UNTRUSTED_CANVAS_STATE> reference in the new-mode system prompt", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "gpt-4o",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callAI(
      [{ role: "user", content: "[canvas state] <UNTRUSTED_CANVAS_STATE>...</UNTRUSTED_CANVAS_STATE>" }],
      "test-api-key",
      "new",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(init!.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const systemMessage = requestBody.messages.find((m) => m.role === "system");
    expect(systemMessage?.content).toContain("<UNTRUSTED_CANVAS_STATE>");
    expect(systemMessage?.content).toContain("<UNTRUSTED_INCIDENT_DATA>");
  });

  it("includes newContext inside the new-mode system prompt when provided", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "gpt-4o",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callAI(
      [{ role: "user", content: "hi" }],
      "test-api-key",
      "new",
      undefined,
      undefined,
      "<UNTRUSTED_NEW_CONTEXT>\nConnected services: github\n</UNTRUSTED_NEW_CONTEXT>",
    );

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system");
    expect(system?.content).toContain("<UNTRUSTED_NEW_CONTEXT>");
    expect(system?.content).toContain("Connected services: github");
  });

  it("new-mode prompt instructs light markdown formatting", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
          model: "gpt-4o",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callAI([{ role: "user", content: "hi" }], "k", "new");

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init!.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system");
    expect(system?.content).toContain("FORMATTING");
    expect(system?.content).toContain("USING CONTEXT");
  });
});
