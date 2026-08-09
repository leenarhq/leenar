import type { Env } from "./types";
import { isUUID, auditLog } from "./utils";
import { startProvisioner } from "./provisionerStart";
import { getDefaultEnvironmentId } from "./envHelpers";
import { claimLock, releaseLock } from "./canvasVersion";
import { scopedQuery, systemQuery } from "./tenancy";
import {
  buildProvisionPlan,
  buildPreloadedCtx,
  CanvasSchema,
  type CanvasNode,
  type CanvasEdge,
} from "./routes/workflowProvision";

export type ClaimDeploySlotResult =
  | { ok: true }
  | {
      ok: false;
      status: 429 | 423 | 503;
      error: string;
      lockedAt?: string;
      lockedBy?: string;
    };

/**
 * Block concurrent deployments for this user and claim the provisioning lock
 * on the project's canvas. Auto-heals stacks whose provisioning session
 * finished or timed out (TTL = session.started_at + DO_TIMEOUT (10 min) + 2
 * min buffer), so long-running deploys aren't falsely healed.
 *
 * Extracted verbatim from the inline guard previously in
 * workflowProvision.ts's `/:projectId/provision` route — pure "extract
 * function", same queries, same batching, same healing semantics.
 *
 * `opts.skipLockClaim` lets a caller run just the active-check/heal portion
 * and claim the canvas lock itself later (the HTTP route needs to validate
 * the request-body canvas between the active-check and the lock claim, so
 * invalid-canvas 400s never acquire a lock).
 */
export async function claimDeploySlot(
  env: Env,
  projectId: string,
  userId: string,
  opts: { skipLockClaim?: boolean } = {},
): Promise<ClaimDeploySlotResult> {
  const DO_TIMEOUT_MS = 10 * 60 * 1000;
  const STUCK_BUFFER_MS = 2 * 60 * 1000;
  const provisioningRes = await scopedQuery(env, userId, "stacks", {
    query: `status=eq.provisioning&select=id,project_id&limit=10`,
  });
  if (!provisioningRes.ok) {
    return {
      ok: false,
      status: 503,
      error: "Service temporarily unavailable. Please try again.",
    };
  }
  const provisioningRows = (await provisioningRes.json()) as Array<{
    id: string;
    project_id: string | null;
  }>;

  if (provisioningRows.length) {
    const toHeal: string[] = [];
    const stillActive: string[] = [];

    // Batch-fetch the latest session for all provisioning stacks in a single query.
    // stackIds come exclusively from the scopedQuery(stacks) result above (already
    // user_id-filtered), so this multi-id IN query is safe-by-construction even
    // though provisioning_sessions has no user_id/project_id of its own to filter
    // on directly (mirrors routes/logs.ts's stack_services IN-query precedent).
    const stackIds = provisioningRows.map((r) => r.id).filter(isUUID);
    const batchSesRes = await systemQuery(
      env,
      `provisioning_sessions?stack_id=in.(${stackIds.join(",")})&select=stack_id,status,started_at&order=started_at.desc`,
    );
    // If the sessions query fails, treat all provisioning stacks as still-active to avoid
    // falsely healing legitimate deploys. A stuck stack will be caught on the next deploy attempt.
    if (!batchSesRes.ok) {
      return {
        ok: false,
        status: 429,
        error: "You already have an active deployment. Please wait for it to finish.",
      };
    }
    const batchSesRows = (await batchSesRes.json()) as Array<{
      stack_id: string;
      status: string;
      started_at: string;
    }>;
    // Keep only the latest session per stack_id (rows are ordered desc, so first wins)
    const latestSession = new Map<
      string,
      { status: string; started_at: string }
    >();
    for (const row of batchSesRows) {
      if (!latestSession.has(row.stack_id)) {
        latestSession.set(row.stack_id, {
          status: row.status,
          started_at: row.started_at,
        });
      }
    }

    for (const row of provisioningRows) {
      const ses = latestSession.get(row.id);

      // Heal if session is in a terminal state (completed, failed, cancelled)
      if (ses && ses.status !== "running") {
        toHeal.push(row.id);
        continue;
      }

      // Heal if session has exceeded DO timeout + buffer (based on started_at, not stack.updated_at)
      const startedAt = ses ? new Date(ses.started_at).getTime() : 0;
      if (Date.now() - startedAt > DO_TIMEOUT_MS + STUCK_BUFFER_MS) {
        toHeal.push(row.id);
      } else {
        stillActive.push(row.id);
      }
    }

    if (toHeal.length) {
      const safeIds = toHeal.filter(isUUID);
      if (safeIds.length) {
        await scopedQuery(env, userId, "stacks", {
          query: `id=in.(${safeIds.join(",")})`,
          method: "PATCH",
          body: { status: "error" },
        });
        // Release the provision lock on each stuck stack's own project.
        // Previously this released the lock on the incoming deploy's projectId
        // (the URL param), which left stuck stacks' projects permanently locked.
        const healedProjects = new Set(
          provisioningRows
            .filter(
              (r) =>
                safeIds.includes(r.id) && r.project_id && isUUID(r.project_id),
            )
            .map((r) => r.project_id as string),
        );
        for (const pid of healedProjects) {
          await releaseLock(env, pid).catch(() => {});
        }
      }
    }

    if (stillActive.length) {
      return {
        ok: false,
        status: 429,
        error: "You already have an active deployment. Please wait for it to finish.",
      };
    }
  }

  if (opts.skipLockClaim) return { ok: true };

  // Claim the provision lock — prevents concurrent deploys and canvas writes during provisioning
  const lockResult = await claimLock(env, projectId, userId, "provisioning");
  if (!lockResult.ok) {
    return {
      ok: false,
      status: 423,
      error: "Workflow is currently being provisioned by another session.",
      lockedAt: lockResult.lockedAt,
      lockedBy: lockResult.lockedBy,
    };
  }

  return { ok: true };
}

export async function deployWorkflow(
  projectId: string,
  userId: string,
  env: Env,
): Promise<{ ok: true; stack_id: string; message: string }> {
  if (!isUUID(projectId)) throw new Error("Invalid project_id");

  const slot = await claimDeploySlot(env, projectId, userId);
  if (!slot.ok) {
    throw Object.assign(new Error(slot.error), { status: slot.status });
  }

  // From here on, the canvas lock is claimed. Every throw point until the DO
  // successfully takes ownership of the lock must release it — otherwise the
  // canvas stays locked forever. `stackId` is only set once the stack row is
  // created, so the error-path cleanup below conditionally clears it too.
  let stackId: string | undefined;
  try {
    const wfRes = await scopedQuery(env, userId, "projects", {
      query: `id=eq.${projectId}&select=id,name,canvas&limit=1`,
    });
    if (!wfRes.ok) throw new Error("Failed to fetch workflow");
    const wfRows = (await wfRes.json()) as Array<{
      id: string;
      name: string;
      canvas: unknown;
    }>;
    if (!wfRows.length) throw new Error("Workflow not found");
    const wf = wfRows[0];

    const parsed = CanvasSchema.safeParse(wf.canvas);
    if (!parsed.success)
      throw new Error(
        "Canvas is invalid or empty — update it in the Leenar editor first",
      );

    const canvas = parsed.data as { nodes: CanvasNode[]; edges: CanvasEdge[] };
    const serviceNodes = canvas.nodes.filter((n) => n.type === "service");
    if (!serviceNodes.length)
      throw new Error(
        "No service nodes in canvas — add at least one provider",
      );

    const serviceIds = new Set(serviceNodes.map((n) => n.id));
    const serviceEdges = (canvas.edges ?? []).filter(
      (e) => serviceIds.has(e.source) && serviceIds.has(e.target),
    );

    const { steps, error: planError } = buildProvisionPlan(
      serviceNodes,
      serviceEdges,
      wf.name,
    );
    if (planError) throw new Error(planError);

    // Resolve default environment so provisioner can write node state back
    let environmentId: string | undefined;
    try {
      environmentId = await getDefaultEnvironmentId(env, projectId);
    } catch {
      // non-fatal — node state won't be persisted but provisioning still works
    }

    const stackRes = await scopedQuery(env, userId, "stacks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        project_id: projectId,
        name: wf.name,
        status: "draft",
        ...(environmentId ? { environment_id: environmentId } : {}),
        requirements: {
          services: steps
            .filter((s) => s.action === "provision")
            .map((s) => ({ service_type: s.service, node_id: s.nodeId })),
        },
      },
    });
    if (!stackRes.ok) throw new Error("Failed to create stack");
    const stackRows = (await stackRes.json()) as Array<{ id: string }>;
    stackId = stackRows[0]?.id;
    if (!stackId) throw new Error("Failed to create stack");

    const preloadedCtx = await buildPreloadedCtx(
      env,
      userId,
      serviceNodes,
      serviceEdges,
      steps,
    );

    const started = await startProvisioner(env, stackId, userId, {
      projectName: wf.name,
      steps,
      preloadedCtx,
    });
    void started.sessionId;

    auditLog(env, userId, "deploy_started", {
      stackId,
      stackName: wf.name,
      source: "mcp",
    });

    return {
      ok: true,
      stack_id: stackId,
      message: `Deployment started for "${wf.name}". Track progress at ${env.FRONTEND_URL}/stacks/${stackId}`,
    };
  } catch (err) {
    // Don't leave an orphaned "draft" stack row behind if we never got the DO started.
    if (stackId) {
      await scopedQuery(env, userId, "stacks", {
        query: `id=eq.${stackId}`,
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: { status: "error" },
      }).catch(() => {});
    }
    // The DO never took ownership of the lock, so release it here — otherwise
    // the canvas stays locked forever. On success, provisioner.do.ts owns
    // releasing the lock on completion/failure/watchdog.
    await releaseLock(env, projectId).catch(() => {});
    throw err;
  }
}
