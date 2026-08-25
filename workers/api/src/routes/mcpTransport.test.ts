// The transport both editions serve at /api/mcp.
//
// These assertions exist because the cloud and core registries now share one
// wire implementation: if it regresses, it regresses for Leenar Cloud and every
// self-hosted server at once. The file imports nothing but the transport, so it
// survives the open-core closure prune and runs in the exported repo too.
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import {
  createMcpRouter,
  type McpRegistry,
  type McpVariables,
} from "./mcpTransport";

const TOOLS = [
  {
    name: "get_canvas",
    description: "read",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "add_service",
    description: "write",
    inputSchema: { type: "object", properties: {} },
  },
];

/** Stand-in worker env — only identity matters, to prove it reaches callTool. */
const ENV = { SUPABASE_URL: "https://example.test" };

/**
 * The transport reads userId/authMethod/apiKeyScope off the Hono context,
 * which appSetup's auth middleware sets before the route runs. Mount it behind
 * a middleware that seeds the same three, so the scope gate has something to
 * read and the test exercises the real code path rather than a stub.
 */
function routerFor(
  vars: {
    userId?: string;
    authMethod?: "jwt" | "api_key";
    apiKeyScope?: "read" | "write";
  },
  registry: Partial<McpRegistry> = {},
) {
  const callTool = vi.fn(async () => ({ ok: true }));
  const app = new Hono<{ Variables: McpVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", vars.userId ?? "u1");
    c.set("authMethod", vars.authMethod ?? "jwt");
    c.set("apiKeyScope", vars.apiKeyScope ?? "read");
    await next();
  });
  app.route(
    "/",
    createMcpRouter({
      tools: TOOLS,
      apiKeyAllowedTools: new Set(["get_canvas"]),
      callTool,
      ...registry,
    }),
  );
  const post = (body: unknown) =>
    app.request(
      "/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
      ENV,
    );
  return { callTool, post };
}

describe("MCP JSON-RPC transport", () => {
  it("answers initialize with the protocol version and server info", async () => {
    const { post } = routerFor({});
    const res = await post({ jsonrpc: "2.0", id: 1, method: "initialize" });
    const body = (await res.json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.result.protocolVersion).toBe("2024-11-05");
    expect(body.result.serverInfo.name).toBe("leenar");
  });

  it("advertises exactly the registry's tools", async () => {
    // The core/cloud difference is supposed to be visible HERE and nowhere
    // else — same transport, different tools/list.
    const { post } = routerFor({});
    const res = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual([
      "get_canvas",
      "add_service",
    ]);
  });

  it("returns 204 with no body for notifications/initialized", async () => {
    const { post } = routerFor({});
    const res = await post({
      jsonrpc: "2.0",
      id: null,
      method: "notifications/initialized",
    });
    expect(res.status).toBe(204);
  });

  it("rejects a write tool for a read-scoped API key without dispatching", async () => {
    const { post, callTool } = routerFor({
      authMethod: "api_key",
      apiKeyScope: "read",
    });
    const res = await post({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "add_service", arguments: {} },
    });
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/write-scoped API key/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("lets a write-scoped API key through to the tool", async () => {
    const { post, callTool } = routerFor({
      authMethod: "api_key",
      apiKeyScope: "write",
    });
    await post({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "add_service", arguments: { project_id: "p1" } },
    });
    expect(callTool).toHaveBeenCalledWith(
      "add_service",
      { project_id: "p1" },
      "u1",
      ENV,
    );
  });

  it("lets a read tool through on a read-scoped key", async () => {
    const { post, callTool } = routerFor({
      authMethod: "api_key",
      apiKeyScope: "read",
    });
    await post({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_canvas", arguments: {} },
    });
    expect(callTool).toHaveBeenCalled();
  });

  it("never applies the key gate to an interactive JWT session", async () => {
    const { post, callTool } = routerFor({ authMethod: "jwt" });
    await post({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "add_service", arguments: {} },
    });
    expect(callTool).toHaveBeenCalled();
  });

  it("reports a thrown tool as isError instead of a 500", async () => {
    // MCP clients surface isError to the model; an HTTP 500 just kills the
    // session, so the error has to come back inside a 2xx JSON-RPC result.
    const { post } = routerFor(
      {},
      {
        callTool: async () => {
          throw new Error("boom");
        },
      },
    );
    const res = await post({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_canvas" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe("boom");
  });

  it("answers a malformed body with a parse error", async () => {
    const { post } = routerFor({});
    const res = await post("not json");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32700);
  });

  it("answers an unknown method with -32601", async () => {
    const { post } = routerFor({});
    const res = await post({ jsonrpc: "2.0", id: 8, method: "resources/list" });
    const body = (await res.json()) as { error: { code: number } };
    expect(body.error.code).toBe(-32601);
  });
});
