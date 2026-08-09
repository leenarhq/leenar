import type { Env } from "../types";

// Structurally identical to incidentMonitorState.ts's IncidentProvider.
// Declared here so the core repo needs no cloud module for the type.
export type IncidentProvider = "vercel" | "cloudflare";

// Structurally identical to aiQuota.ts's QuotaCheck.
export interface QuotaCheck {
  allowed: boolean;
  reason?: "user_daily_limit" | "user_daily_cost_limit" | "global_daily_cap" | "service_unavailable";
  messagesUsed?: number;
}

export type QuotaReservation = QuotaCheck & { reservationId: string | null };

export interface ProvisioningHooks {
  quota: {
    dailyUserMsgLimit: number;
    reserve(userId: string, env: Env): Promise<QuotaReservation>;
    release(userId: string, env: Env): Promise<void>;
    recordTokens(
      userId: string,
      model: string,
      inputTokens: number,
      outputTokens: number,
      env: Env,
      reservationId?: string | null,
    ): Promise<void>;
  };
  monitor: {
    start(
      env: Env,
      projectId: string,
      userId: string,
      provider: IncidentProvider,
      resourceId: string,
    ): Promise<void>;
    stop(env: Env, projectId: string, resourceId?: string, provider?: string): Promise<void>;
  };
  rateLimit: {
    check(env: Env, userId: string, key: string, limit: number, windowMs: number): Promise<boolean>;
  };
  autopilot: {
    // Bounded, policy-gated auto-reconcile of a project's open drifts.
    // No-op in core (no autopilot); cloud delegates to tryAutoReconcile.
    reconcile(env: Env, projectId: string, userId: string): Promise<void>;
  };
}
