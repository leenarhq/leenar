import type { Env } from "./types";
import { signDoToken } from "./doAuth";
import type { ProvisionStep } from "./routes/workflowProvision";

export interface ApprovedStackInput {
  projectName: string;
  steps: ProvisionStep[];
  preloadedCtx?: Record<string, string>;
}

/**
 * Sign the internal token, start the ProvisionerDO for `stackId`, and return
 * its sessionId. Throws on any non-ok DO response or a body missing sessionId —
 * callers rely on this throw to release the canvas lock (the DO only owns the
 * lock once it has genuinely started). Single source of truth for the DO-start
 * handshake, used by both the HTTP provision route and the MCP deploy path.
 */
export async function startProvisioner(
  env: Env,
  stackId: string,
  userId: string,
  approvedStack: ApprovedStackInput,
): Promise<{ sessionId: string }> {
  const doId = env.PROVISIONER.idFromName(stackId);
  const stub = env.PROVISIONER.get(doId);
  const doToken = await signDoToken(env.INTERNAL_SECRET, "start");
  const doRes = await stub.fetch(
    new Request("https://do/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": doToken,
      },
      body: JSON.stringify({ stackId, userId, approvedStack }),
    }),
  );
  if (!doRes.ok) {
    const body = await doRes.text().catch(() => "");
    throw new Error(
      `ProvisionerDO start failed (${doRes.status}): ${body.slice(0, 200)}`,
    );
  }
  const result = (await doRes.json().catch(() => ({}))) as {
    sessionId?: string;
  };
  if (!result.sessionId) {
    throw new Error("ProvisionerDO start returned no sessionId");
  }
  return { sessionId: result.sessionId };
}
