// The MCP JSON-RPC transport, shared by both editions.
//
// routes/mcp.ts (cloud) and routes/mcp.core.ts differ only in WHICH tools they
// advertise and dispatch. The wire protocol, the API-key scope gate and the
// error envelopes are identical — and must stay identical, because an MCP
// client that works against Leenar Cloud and subtly misbehaves against a
// self-hosted worker is the worst possible failure here: the client reports it
// as "the tool errored", never as "these two servers disagree".
//
// So the transport is defined once and each edition passes its own registry,
// the same way both editions already share the canvas handlers in
// routes/mcpCanvasTools.ts and keep only a dispatch table of their own.
import { Hono } from "hono";
import type { Env } from "../types";

type JsonRpcId = number | string | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export interface McpToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpRegistry {
  /** Advertised by tools/list. A tool absent here is invisible to clients. */
  tools: readonly McpToolSchema[];
  /**
   * Tools any API key may call. Everything else needs a write-scoped key —
   * this set is the read/write line, not the allow/deny line, so leaving a
   * tool out of it restricts rather than blocks it.
   */
  apiKeyAllowedTools: ReadonlySet<string>;
  callTool(
    name: string,
    args: Record<string, string>,
    userId: string,
    env: Env,
    source?: string,
    allowedTools?: ReadonlySet<string>,
  ): Promise<unknown>;
}

/** What appSetup's auth middleware has already put on the context. */
export interface McpVariables {
  userId: string;
  authMethod: "jwt" | "api_key";
  apiKeyScope: "read" | "write";
}

const SERVER_INFO = { name: "leenar", version: "1.0.0" };
const PROTOCOL_VERSION = "2024-11-05";

export function createMcpRouter(registry: McpRegistry) {
  const router = new Hono<{ Bindings: Env; Variables: McpVariables }>();

  router.post("/", async (c) => {
    const userId = c.get("userId");
    let req: JsonRpcRequest;

    try {
      req = await c.req.json<JsonRpcRequest>();
    } catch {
      return c.json(rpcErr(null, -32700, "Parse error"), 400);
    }

    const { id, method, params } = req;

    if (method === "initialize") {
      return c.json(
        ok(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        }),
      );
    }

    if (method === "notifications/initialized") {
      return new Response(null, { status: 204 });
    }

    if (method === "tools/list") {
      return c.json(ok(id, { tools: registry.tools }));
    }

    if (method === "tools/call") {
      const p = params as { name: string; arguments?: Record<string, string> };
      const authMethod = c.get("authMethod");
      if (authMethod === "api_key" && !registry.apiKeyAllowedTools.has(p.name)) {
        // Write tool via API key — allowed only for write-scoped keys.
        // Read tools stay open to any key; destructive ops still require
        // confirm:true (see the cloud callTool).
        const scope = c.get("apiKeyScope");
        if (scope !== "write") {
          return c.json(
            ok(id, {
              content: [
                {
                  type: "text",
                  text: `Tool "${p.name}" requires a write-scoped API key (or interactive JWT). This key is read-only.`,
                },
              ],
              isError: true,
            }),
          );
        }
      }
      try {
        const result = await registry.callTool(
          p.name,
          p.arguments ?? {},
          userId,
          c.env,
        );
        return c.json(
          ok(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Tool error";
        return c.json(
          ok(id, { content: [{ type: "text", text: msg }], isError: true }),
        );
      }
    }

    return c.json(rpcErr(id, -32601, `Method not found: ${method}`));
  });

  return router;
}
