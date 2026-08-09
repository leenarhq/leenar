/**
 * Projection: fold provisioning_events back into the provisioning_sessions.steps
 * shape so the UI continues reading the same table unchanged.
 *
 * Called:
 *  (a) at session end inside the DO (authoritative)
 *  (b) on-demand via POST /api/sessions/:id/project
 *  (c) periodically from the scheduled drift-check handler
 *
 * Also provides getProvisionedResources() which deprovision / drift detection
 * use when workflows.use_events = true, to determine what cloud resources
 * actually exist — even if the canvas was later edited.
 */
import { systemQuery } from "./tenancy";
import type { Env } from "./types";
import { loadSessionEvents, loadStackEvents, type EventType } from "./eventSourcing";

interface StepRecord {
  name: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  output?: Record<string, unknown>;
}

export interface ProvisionedResource {
  service: string;
  nodeId: string;
  resourceId: string;
  secretKeys?: string[];
  created?: boolean;
}

/** Fold session events into a steps array and write back to provisioning_sessions. */
export async function projectSession(env: Env, sessionId: string): Promise<void> {
  const events = await loadSessionEvents(env, sessionId);
  if (events.length === 0) return;

  const steps: StepRecord[] = [];
  let sessionStatus: string | undefined;
  let sessionError: string | undefined;
  let sessionFinishedAt: string | undefined;

  for (const ev of events) {
    const p = ev.payload;
    const idx = typeof p.stepIndex === "number" ? p.stepIndex : null;

    switch (ev.type as EventType) {
      case "SessionStarted":
        break;
      case "StepStarted":
        if (idx !== null) {
          if (!steps[idx]) steps[idx] = { name: String(p.service ?? ""), status: "running" };
          steps[idx].status = "running";
          steps[idx].started_at = String(p.startedAt ?? "");
        }
        break;
      case "StepCompleted":
        if (idx !== null) {
          if (!steps[idx]) steps[idx] = { name: String(p.service ?? ""), status: "success" };
          steps[idx].status = "success";
          steps[idx].finished_at = String(p.finishedAt ?? "");
          if (p.output) steps[idx].output = p.output as Record<string, unknown>;
        }
        break;
      case "StepFailed":
      case "StepRetried":
        if (idx !== null) {
          if (!steps[idx]) steps[idx] = { name: String(p.service ?? ""), status: "error" };
          if (ev.type === "StepFailed") {
            steps[idx].status = "error";
            steps[idx].error = String(p.error ?? "");
            steps[idx].finished_at = String(p.finishedAt ?? "");
          }
        }
        break;
      case "SessionCompleted":
        sessionStatus = "success";
        sessionFinishedAt = String(p.finishedAt ?? new Date().toISOString());
        break;
      case "SessionFailed":
      case "Aborted":
        sessionStatus = ev.type === "Aborted" ? "cancelled" : "failed";
        sessionError = String(p.error ?? "");
        sessionFinishedAt = String(p.finishedAt ?? new Date().toISOString());
        break;
      default:
        break;
    }
  }

  const patch: Record<string, unknown> = { steps };
  if (sessionStatus) {
    patch.status = sessionStatus;
    patch.finished_at = sessionFinishedAt;
    if (sessionError) patch.error_message = sessionError;
  }

  await systemQuery(env, `provisioning_sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" } as HeadersInit,
    body: JSON.stringify(patch),
  }).catch(() => {});
}

/**
 * Assemble the authoritative list of provisioned resources for a stack from events.
 * Used by deprovision and drift detection when workflows.use_events = true.
 * This is append-only data — immune to canvas edits that remove nodes.
 */
export async function getProvisionedResources(
  env: Env,
  stackId: string,
): Promise<ProvisionedResource[]> {
  const events = await loadStackEvents(env, stackId);
  const resources: ProvisionedResource[] = [];
  const secretKeysByNode = new Map<string, string[]>();

  for (const ev of events) {
    const p = ev.payload;
    if (ev.type === "StepCompleted" && p.nodeId && p.service && p.resourceId) {
      // Deduplicate by nodeId (last StepCompleted for a node wins)
      const existing = resources.findIndex((r) => r.nodeId === String(p.nodeId));
      const resource: ProvisionedResource = {
        service: String(p.service),
        nodeId: String(p.nodeId),
        resourceId: String(p.resourceId),
        created: p.created === true,
      };
      if (existing >= 0) resources[existing] = resource;
      else resources.push(resource);
    }
    if (ev.type === "SecretInjected" && p.nodeId && Array.isArray(p.keys)) {
      secretKeysByNode.set(String(p.nodeId), p.keys as string[]);
    }
  }

  // Attach secret key lists
  for (const resource of resources) {
    const keys = secretKeysByNode.get(resource.nodeId);
    if (keys?.length) resource.secretKeys = keys;
  }

  return resources;
}
