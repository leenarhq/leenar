/**
 * Append-only event emitter for provisioning sessions.
 *
 * Events are written alongside (not instead of) existing DB writes.
 * The sequence counter is stored in DO storage BEFORE the DB write so
 * eviction can never double-emit: a re-started DO resumes at a higher
 * sequence and the UNIQUE constraint on (session_id, idempotency_key)
 * acts as a duplicate gate.
 *
 * Event types:
 *   SessionStarted | StepStarted | StepCompleted | StepFailed | StepRetried
 *   SecretInjected | CanvasNodePatched | SessionCompleted | SessionFailed | Aborted
 */
import { redactPayload } from "./utils";
import type { Env } from "./types";
import { systemQuery } from "./tenancy";

export { redactPayload };

export type EventType =
  | "SessionStarted"
  | "StepStarted"
  | "StepCompleted"
  | "StepFailed"
  | "StepRetried"
  | "SecretInjected"
  | "CanvasNodePatched"
  | "SessionCompleted"
  | "SessionFailed"
  | "Aborted"
  | "TeardownCompleted"
  | "Warning";

export interface EmitOptions {
  sessionId: string;
  stackId: string;
  type: EventType;
  payload?: Record<string, unknown>;
  /** Unique key preventing duplicates on DO eviction restart. */
  idempotencyKey: string;
  sequence: number;
}

export async function emit(env: Env, opts: EmitOptions): Promise<void> {
  // provisioning_events has no user_id column (session/stack-scoped only —
  // see provisioning_events RLS, which checks ownership via a stacks join).
  // No userId parameter here either; systemQuery preserves this background,
  // append-only write exactly.
  const res = await systemQuery(env, "provisioning_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" } as HeadersInit,
    body: JSON.stringify({
      stack_id: opts.stackId,
      session_id: opts.sessionId,
      sequence: opts.sequence,
      type: opts.type,
      payload: redactPayload(opts.payload ?? {}),
      idempotency_key: opts.idempotencyKey,
    }),
  });
  // 409 = the (session_id, idempotency_key) row already exists — an idempotent
  // replay, which is success for our purposes. Any other non-2xx is a real
  // failure the caller may want to retry (durable events).
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `emit ${opts.type} failed (${res.status}): ${body.slice(0, 120)}`,
    );
  }
}

/** Load all events for a session, ordered by sequence. */
export async function loadSessionEvents(
  env: Env,
  sessionId: string,
): Promise<Array<{ type: EventType; payload: Record<string, unknown>; sequence: number }>> {
  // No userId parameter; provisioning_events has no user_id column. systemQuery
  // preserves the existing session-scoped read exactly.
  const res = await systemQuery(
    env,
    `provisioning_events?session_id=eq.${sessionId}&select=type,payload,sequence&order=sequence.asc`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Array<{
    type: EventType;
    payload: Record<string, unknown>;
    sequence: number;
  }>;
}

/** Load all events for a stack, ordered by creation time. Used by getProvisionedResources. */
export async function loadStackEvents(
  env: Env,
  stackId: string,
): Promise<Array<{ type: EventType; payload: Record<string, unknown>; sequence: number }>> {
  // Same rationale as loadSessionEvents above: no userId in scope, no
  // user_id column on provisioning_events.
  const res = await systemQuery(
    env,
    `provisioning_events?stack_id=eq.${stackId}&select=type,payload,sequence&order=sequence.asc`,
  );
  if (!res.ok) return [];
  return (await res.json()) as Array<{
    type: EventType;
    payload: Record<string, unknown>;
    sequence: number;
  }>;
}
