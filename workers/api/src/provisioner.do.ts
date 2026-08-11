import type { Env } from "./types";
import { decrypt, encrypt } from "./crypto";
import { verifyDoToken } from "./doAuth";
import {
  auditLog,
  redactPayload,
  redactSecretsFromText,
  isSecretKey,
} from "./utils";
import { systemQuery } from "./tenancy";
import {
  releaseLock,
  patchWorkflowCanvasNodeVersioned,
  markConfigOnlyNodesProvisioned,
} from "./canvasVersion";
import { createLogger } from "./logger";
import { setEnvNodeState, getAllEnvNodeState } from "./envHelpers";
import {
  computeDesiredEnvKeys,
  inferServiceKey,
  scopedCtxOverrides,
} from "./envFlowUtils";
import { detectFramework, hasWranglerConfig } from "./detectFramework";
import type { Framework } from "./constants/envFlow";
import {
  provisionVercel,
  injectVercelEnvVars,
  redeployVercel,
  relinkVercelWithGitHub,
  assertVercelGitHubLinked,
  deprovisionVercel,
} from "./connectors/vercel";
import {
  provisionSupabase,
  cloneSupabase,
  applySupabaseSchema,
  configureSupabaseAuth,
  deprovisionSupabase,
} from "./connectors/supabase";
import {
  getAccountId,
  provisionR2,
  updateWorkerSecrets,
  deprovisionCloudflareWorker,
  deprovisionR2Bucket,
  getWorkersSubdomain,
} from "./connectors/cloudflare";
import {
  pushLeenarCommitAsApp,
  createGitHubDeployment,
  getInstallationTokenForRepo,
  writeWorkflowFileAsApp,
  dispatchWorkflow,
  findWorkflowRun,
  getWorkflowRunFailureTail,
  getWranglerWorkerName,
} from "./connectors/github-app";
import { putRepoActionsSecret } from "./connectors/github-actions-secrets";
import { verifyRepo, branchGitHub } from "./connectors/github";
import { resolveBranchDecision } from "./connectors/capabilities";
import { dispatchWebhooks } from "./webhookDispatch";
import { RateLimitError } from "./connectors/errors";
import { provisioningHooks } from "./hooks/provisioningHooks";
import { emit, loadSessionEvents, type EventType } from "./eventSourcing";
import { projectSession, getProvisionedResources } from "./projectEvents";
import {
  deploySuccessEmail,
  deployFailureEmail,
} from "./emails/deployNotification";

// Durable Object — one instance per provisioning job
// Secrets live only in this object's memory, never written to DB
export class ProvisionerDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private cancelled = false;
  private timedOut = false;
  // Wall-clock start of the active provision (epoch ms), stashed so the
  // timeout-cleanup path — which runs outside runWithSession's local scope —
  // can record an accurate started_at on the failed deployment row.
  private deployStartedAt = 0;
  private abortController = new AbortController();
  private activeSession: string | null = null;
  private cachedSteps: ProvisionStepRecord[] = [];
  private _seqCounters = new Map<string, number>();
  // Known secret values seen during this provision (decrypted OAuth tokens,
  // injected env var values, generated credentials) — scrubbed out of any
  // free-text log/audit message before it's written, so a provider echoing a
  // secret back in an error body never reaches client-readable storage.
  private secretValues = new Set<string>();
  // Resources this run created (created===true), tracked in-memory so a
  // same-isolate failure path (timeout/fatal/step-failure) can tear them down
  // even if the durable StepCompleted event did not land. Reset per run.
  private createdResources: Array<{
    service: string;
    nodeId: string;
    resourceId: string;
    created: boolean;
  }> = [];
  // Native-branching context for the current provision run. Non-null only when
  // the deploy targets a branch environment (env.branch_key set). Resolved once
  // per run in `provision()` and read by `executeStep` to branch each provider
  // natively (git branch / Vercel preview) or into an isolated resource
  // (Supabase clone / suffixed CF names). `trunkState` holds the default env's
  // live node state — the source refs a branch derives from (spec §6.3: read
  // trunk live, never a stale snapshot). Reset at the top of every run.
  private branchCtx: {
    branchKey: string;
    trunkState: Record<string, import("./envHelpers").EnvNodeState>;
  } | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  /** Fire-and-forget event emit — never blocks the provision path. */
  private async _emit(
    sessionId: string,
    stackId: string,
    type: EventType,
    payload: Record<string, unknown> = {},
    idempotencyKeySuffix: string = type,
    opts?: { durable?: boolean },
  ): Promise<void> {
    const seqKey = `seq:${sessionId}`;
    // Restore counter from durable storage on first use after a DO eviction/cold-start.
    // Without this, the in-memory counter restarts at 0 and overwrites the persisted value.
    if (!this._seqCounters.has(seqKey)) {
      const stored = await this.state.storage
        .get<number>(seqKey)
        .catch(() => undefined);
      if (stored) this._seqCounters.set(seqKey, stored);
    }
    const seq = (this._seqCounters.get(seqKey) ?? 0) + 1;
    this._seqCounters.set(seqKey, seq);
    await this.state.storage.put(seqKey, seq);
    const emitOpts = {
      sessionId,
      stackId,
      type,
      payload,
      idempotencyKey: `${sessionId}:${idempotencyKeySuffix}`,
      sequence: seq,
    };
    if (opts?.durable) {
      // Teardown and workflow-delete reconstruct what to clean up from these
      // events — a dropped StepCompleted orphans the resource. Retry 3× and
      // await, but never throw (called from the provision path).
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await emit(this.env, emitOpts);
          return;
        } catch (err) {
          if (attempt === 3) {
            createLogger({ session: sessionId, stack: stackId }).error(
              "provision.emit_durable_failed",
              { type, error: err instanceof Error ? err.message : String(err) },
            );
            return;
          }
          await scheduler.wait(500 * attempt);
        }
      }
    } else {
      await emit(this.env, emitOpts).catch(() => {});
    }
  }

  // Watchdog alarm — fires if the DO crashes mid-provision and never cleans up.
  // Each step resets the alarm to now+15 min; success/failure deletes it.
  async alarm() {
    // Fast path: a step-loop continuation is pending (the common case — an
    // alarm scheduled by runOneStep to yield the invocation between steps so
    // the next step gets a fresh subrequest budget). Distinguish from the
    // slow crash-recovery path below by whether ANY stepLoop:* key exists
    // for the watchdog's sessionId.
    const watchdogPeek = await this.state.storage.get<WatchdogState>("watchdog");
    if (watchdogPeek) {
      const pendingLoop = await this.loadStepLoopState(watchdogPeek.sessionId);
      if (pendingLoop) {
        // this.cachedSteps is an in-memory field, empty on a fresh isolate.
        // runOneStep's step-completion path (mutateCachedStep -> stepCompleteRpc)
        // sends the FULL this.cachedSteps array to overwrite
        // provisioning_sessions.steps — resuming with a stale/empty array would
        // silently corrupt that column. Rehydrate from the DB (the authoritative
        // copy, already correct from the prior invocation's writes) before
        // running the next step. This mirrors how the existing watchdog
        // reconciliation branch below also re-reads `steps` from the DB rather
        // than trusting in-memory state on a cross-isolate resume.
        const stepsRes = await systemQuery(
          this.env,
          `provisioning_sessions?id=eq.${pendingLoop.sessionId}&select=steps`,
        );
        if (stepsRes.ok) {
          const rows = await stepsRes.json<Array<{ steps?: ProvisionStepRecord[] }>>();
          this.cachedSteps = rows[0]?.steps ?? [];
        }
        // this.branchCtx is an in-memory field too, and is read throughout
        // executeStep to derive branch-specific resource identity (branch-
        // suffixed Vercel project name, CF Workers name, R2 bucket suffix).
        // On a fresh isolate it's back at its constructor default of `null`
        // — restore it from the persisted loop state before running the
        // next step, or a branch-environment deploy would silently
        // provision steps 1+ with trunk naming/topology.
        this.branchCtx = pendingLoop.branchCtx;
        const loop = pendingLoop;
        // Resuming a step from a fresh invocation: run it, then finalize if
        // that was the last step. A throw here (e.g. the step's connector
        // call fails) must reach the same terminal-failure path a first-
        // invocation error would via runWithSession's catch — finalizeFailure
        // accepts `loop` directly since a full StepLoopState structurally
        // satisfies the narrower FinalizeFailureIds it needs.
        try {
          const result = await this.runOneStep(loop);
          if (result === "done" && loop.nextStepIndex >= loop.stack.steps.length) {
            // Last step just succeeded — no finalize code has run yet for
            // this session (unlike the first-invocation path, this resumed
            // invocation never touches runWithSession's inline finalize).
            await this.finalizeSuccess(loop);
          }
        } catch (err: unknown) {
          await this.finalizeFailure(loop, err);
        }
        return;
      }
    }
    const recovery = await this.state.storage.get<WatchdogState>("watchdog");
    if (!recovery) return;
    const logger = createLogger({
      session: recovery.sessionId,
      stack: recovery.stackId,
    });
    logger.error("provision.alarm_fired");
    try {
      // Reconcile from the ACTUAL step outcomes, don't assume failure. A deploy
      // whose every provision step succeeded but whose finalize terminal-write
      // never landed (a DB blip in updateSession, or an isolate eviction right
      // after the last step) must recover as SUCCESS — not be torn down and
      // reported as a spurious failure. Only genuinely incomplete runs fail.
      let allStepsSucceeded = false;
      try {
        const sres = await systemQuery(
          this.env,
          `provisioning_sessions?id=eq.${recovery.sessionId}&select=steps`,
        );
        if (sres.ok) {
          const srows = await sres.json<
            Array<{ steps?: Array<{ status?: string }> }>
          >();
          const steps = srows[0]?.steps ?? [];
          allStepsSucceeded =
            steps.length > 0 && steps.every((s) => s.status === "success");
        }
      } catch {
        /* couldn't read steps — fall through to failure recovery */
      }

      if (allStepsSucceeded) {
        await this.updateSession(recovery.sessionId, "success");
        await this.updateStatus(recovery.stackId, "ready");
        if (recovery.workflowId) {
          await this.updateProjectStatus(recovery.workflowId, "active").catch(
            () => {},
          );
          await markConfigOnlyNodesProvisioned(
            this.env,
            recovery.workflowId,
          ).catch(() => {});
        }
      } else {
        // Cross-isolate: this fresh isolate has no in-memory ledger, so teardown
        // reconstructs created resources from the durable event log. Requires the
        // userId persisted on the watchdog row (legacy rows without it are skipped).
        if (recovery.userId) {
          await this.compensateTeardown(
            recovery.stackId,
            recovery.userId,
            recovery.sessionId,
          ).catch(() => {});
        }
        await this.updateSession(
          recovery.sessionId,
          "failed",
          "Provisioning was interrupted unexpectedly. Please try again.",
        );
        await this.updateStatus(recovery.stackId, "error");
      }
      // Release the provision lock so the user can redeploy
      if (recovery.workflowId) {
        await releaseLock(this.env, recovery.workflowId, recovery.userId).catch(
          () => {},
        );
      }
    } catch {
      /* best-effort */
    }
    await this.state.storage.delete("watchdog");
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const action = url.pathname.slice(1); // 'start' | 'cancel'

    const token = req.headers.get("X-Internal-Token") ?? "";
    // Pass DO storage so nonce replay protection is durable across isolate
    // eviction rather than living only in isolate-local memory.
    if (
      !(await verifyDoToken(
        token,
        this.env.INTERNAL_SECRET,
        action,
        this.state.storage,
      ))
    ) {
      return new Response("Forbidden", { status: 403 });
    }

    if (action === "start") {
      const { stackId, userId, approvedStack } = await req.json<{
        stackId: string;
        userId: string;
        approvedStack: ApprovedStack;
      }>();

      // Reject duplicate start calls for the same DO instance (same stackId)
      if (this.activeSession) {
        return Response.json(
          { ok: false, error: "A provisioning session is already active" },
          { status: 409 },
        );
      }

      this.activeSession = "pending"; // claim slot before any await
      // Create session synchronously so caller gets the sessionId
      const sessionId = await this.createSession(stackId, approvedStack.steps);
      this.activeSession = sessionId;
      // waitUntil keeps the DO alive until provisioning finishes —
      // without this the object can be evicted mid-run (idle timeout ~30s)
      const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => {
          this.timedOut = true;
          // Abort in-flight requests and signal the step loop to stop. Without this,
          // Promise.race only rejects the outer promise while runWithSession keeps
          // provisioning real resources after the failure has already been reported.
          this.abortController.abort();
          reject(new Error("Provisioning timed out after 10 minutes"));
        }, TIMEOUT_MS),
      );
      this.state.waitUntil(
        Promise.race([
          this.runWithSession(sessionId, stackId, userId, approvedStack),
          timeoutPromise,
        ])
          // Last-writer-wins semantics: runWithSession's own step-failure branch
          // (see the `if (!this.timedOut)` guard around the "StepFailed" handling)
          // writes the terminal "failed"/"error" status itself when the failure
          // happens before a timeout, then returns — so this .catch only sees
          // the rejection on genuine unhandled errors or on timeout (where
          // abortController.abort() causes runWithSession to reject instead of
          // returning normally). That's why callers inside runWithSession skip
          // their own terminal write when `this.timedOut` is true: writing there
          // AND here would race, and the in-flight step's write could clobber
          // this timeout-triggered write (or vice versa) with stale data. This
          // top-level catch is therefore the single guaranteed terminal writer
          // for the timeout path, and — now that updateSession/updateStatus
          // retry internally (P0.1) — the most reliable place overall to land
          // a final status even if an earlier write attempt failed.
          .catch(async (err) => {
            createLogger({ session: sessionId, stack: stackId }).error(
              "provision.unhandled_error",
              { err: err instanceof Error ? err.message : String(err) },
            );
            await this.updateSession(
              sessionId,
              "failed",
              err instanceof Error ? err.message : String(err),
            );
            await this.updateStatus(stackId, "error");
            // Release canvas lock immediately on timeout so the user can re-deploy
            // without waiting for the still-running step inside runWithSession to finish.
            // runWithSession also calls releaseLock on completion, but that may take minutes.
            // handleTimeoutCleanup also tears down resources created so far (same
            // isolate → in-memory ledger) so a timed-out deploy leaves no orphans,
            // then cancels watchdog recovery (the timeout is already a failure, so a
            // later alarm must not re-mark status or release a since-reclaimed lock).
            if (this.timedOut) {
              await this.handleTimeoutCleanup(sessionId, stackId, userId);
            }
          })
          .finally(() => {
            this.activeSession = null;
          }),
      );
      return Response.json({ ok: true, sessionId });
    }

    if (action === "cancel") {
      const { stackId } = await req
        .json<{ stackId: string }>()
        .catch(() => ({ stackId: "" }));
      if (!stackId || !/^[0-9a-f-]{36}$/i.test(stackId)) {
        return Response.json({ error: "Invalid stackId" }, { status: 400 });
      }
      // Abort only after validating input — a malformed body must not kill a live deploy
      this.cancelled = true;
      this.abortController.abort();
      // Resolve the running session id: in-memory for a same-isolate cancel, else
      // read it off the watchdog row (a cross-isolate cancel has no in-memory ledger).
      const watchdog =
        await this.state.storage.get<WatchdogState>("watchdog");
      const sessionId =
        (this.activeSession && this.activeSession !== "pending"
          ? this.activeSession
          : undefined) ?? watchdog?.sessionId;
      // Only write "error" if the stack hasn't already completed successfully
      const check = await systemQuery(this.env, `stacks?id=eq.${stackId}&select=status`);
      const rows = await check
        .json<Array<{ status: string }>>()
        .catch(() => [] as Array<{ status: string }>);
      let terminalSessionId: string | undefined = undefined;
      if (rows[0]?.status !== "ready") {
        await this.updateStatus(stackId, "error");
        // Mirror stacks.status onto projects.status (watchdog.workflowId is the
        // projectId) so a cancelled deploy doesn't leave the workflow card stuck
        // on a stale 'active'/'draft'.
        if (watchdog?.workflowId)
          await this.updateProjectStatus(watchdog.workflowId, "error").catch(
            () => {},
          );
        // Authoritatively terminate the session here. We CANNOT rely on
        // abortController.abort() propagating a rejection into runWithSession's
        // top-level `.catch` (the timeout path's single writer): the graceful
        // in-loop cancel check (line ~606) only runs at the TOP of a step
        // iteration, so a cancel that lands after the last step's iteration has
        // ended — or between the non-abortable finalize writes — leaves the loop
        // to exit normally with no terminal session write. Because we delete the
        // watchdog + alarm just below, nothing would ever recover it, stranding
        // the session at status='running'/finished_at=null forever. The frontend
        // polls that session and only leaves its RUNNING state on a terminal
        // status, so config-only nodes (github/resend) would sit at DRAFT for good.
        // Guarantee a terminal session write. sessionId may be unresolvable from
        // memory (cross-isolate cancel) or a watchdog row that's missing/without
        // it — in which case fall back to the stack's running session in the DB.
        // Without this the session is stranded at 'running'/finished_at=null and,
        // since the watchdog+alarm are deleted just below, nothing ever recovers
        // it: the frontend polls "running" forever ("deployment never finishes").
        terminalSessionId = sessionId;
        if (!terminalSessionId) {
          const sres = await systemQuery(
            this.env,
            `provisioning_sessions?stack_id=eq.${stackId}&status=eq.running&select=id&order=started_at.desc&limit=1`,
          );
          const srows = sres.ok
            ? await sres
                .json<Array<{ id: string }>>()
                .catch(() => [] as Array<{ id: string }>)
            : [];
          terminalSessionId = srows[0]?.id;
        }
        if (terminalSessionId) {
          await this.updateSession(
            terminalSessionId,
            "cancelled",
            "Provisioning cancelled by user.",
          );
        }
      }
      await this.state.storage.delete("watchdog");
      if (terminalSessionId) await this.clearStepLoopState(terminalSessionId);
      await this.state.storage.deleteAlarm();
      // Release the canvas lock here too. The graceful in-loop cancel branch
      // releases it, but that branch only runs if the abort is caught at the top
      // of a step iteration; a cancel after the last step never reaches it, so
      // without this the project stays locked until the 5-minute forceUnlock.
      if (watchdog?.workflowId) {
        await releaseLock(this.env, watchdog.workflowId, watchdog.userId).catch(
          () => {},
        );
      }
      return Response.json({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  }

  private async runWithSession(
    sessionId: string,
    stackId: string,
    userId: string,
    stack: ApprovedStack,
  ) {
    const logger = createLogger({ session: sessionId, stack: stackId, userId });
    logger.info("provision.start", { steps: stack.steps.length });
    const sessionStartedAt = Date.now();
    this.deployStartedAt = sessionStartedAt;
    let projectId: string | null = null;
    try {
      // Resolve project_id and environment_id from the stack row
      const stackRow = await systemQuery(
        this.env,
        `stacks?id=eq.${stackId}&select=project_id,environment_id&limit=1`,
      );
      if (!stackRow.ok)
        throw new Error(`Failed to fetch stack ${stackId}: ${stackRow.status}`);
      const stackRows = (await stackRow.json()) as Array<{
        project_id: string | null;
        environment_id: string | null;
      }>;
      projectId = stackRows[0]?.project_id ?? null;
      const environmentId = stackRows[0]?.environment_id ?? null;

      // Emit SessionStarted — fire-and-forget
      await this._emit(sessionId, stackId, "SessionStarted", {
        steps: stack.steps.length,
        projectId,
        startedAt: new Date().toISOString(),
      });

      // Pre-compute desiredEnvKeys per node from the canvas (for drift detection after provisioning)
      const desiredEnvKeysMap: Record<string, string[]> = {};
      let canvasSnapshot: unknown = {};
      if (projectId) {
        // Drift keys must reflect the TOPOLOGY of the env being deployed. For a
        // branch env the branch's own canvas (project_environments.canvas) is
        // authoritative — reading projects.canvas would compute drift against the
        // trunk topology. Prefer the env canvas when we have an environmentId and
        // it carries nodes; fall back to projects.canvas otherwise.
        let canvasRows: Array<{
          canvas: { nodes: unknown[]; edges: unknown[] } | null;
        }> = [];
        if (environmentId) {
          const envCanvasRes = await systemQuery(
            this.env,
            `project_environments?id=eq.${environmentId}&select=canvas&limit=1`,
          );
          if (envCanvasRes.ok) {
            const envRows = (await envCanvasRes.json()) as Array<{
              canvas: { nodes: unknown[]; edges: unknown[] } | null;
            }>;
            if ((envRows[0]?.canvas?.nodes?.length ?? 0) > 0)
              canvasRows = envRows;
          }
        }
        if (canvasRows.length === 0) {
          const canvasRes = await systemQuery(
            this.env,
            `projects?id=eq.${projectId}&select=canvas&limit=1`,
          );
          if (canvasRes.ok) {
            canvasRows = (await canvasRes.json()) as Array<{
              canvas: { nodes: unknown[]; edges: unknown[] } | null;
            }>;
          } else {
            logger.warn("provision.canvas_fetch_failed", {
              status: canvasRes.status,
            });
          }
        }
        canvasSnapshot = canvasRows[0]?.canvas ?? {};
        const canvas = canvasSnapshot as
          | {
              nodes: Array<{ id: string; data: Record<string, unknown> }>;
              edges: Array<{ source: string; target: string }>;
            }
          | undefined;
        if (canvas?.nodes) {
          for (const step of stack.steps) {
            if (step.nodeId) {
              desiredEnvKeysMap[step.nodeId] = computeDesiredEnvKeys(
                canvas,
                step.nodeId,
              );
            }
          }
        }
      }

      // ── Resolve native-branching context for this run ────────────────────
      // ANY non-default env is a branch: it must get its own isolated/native
      // resources and never silently share the default (trunk) env's cloud
      // resources. The branch key is the env's `branch_key` when set, else its
      // `slug` (covers envs created via "Create environment", which doesn't set
      // branch_key, and pre-migration envs). We read the trunk env's LIVE node
      // state so branch steps derive source refs from reality, not a snapshot.
      this.branchCtx = null;
      if (environmentId && projectId) {
        try {
          const envMetaRes = await systemQuery(
            this.env,
            `project_environments?id=eq.${environmentId}&select=branch_key,slug,is_default&limit=1`,
          );
          if (envMetaRes.ok) {
            const meta = (await envMetaRes.json()) as Array<{
              branch_key: string | null;
              slug: string;
              is_default: boolean;
            }>;
            const row = meta[0];
            const branchKey = row?.branch_key ?? row?.slug;
            if (row && !row.is_default && branchKey) {
              const defRes = await systemQuery(
                this.env,
                `project_environments?project_id=eq.${projectId}&is_default=eq.true&select=id&limit=1`,
              );
              const defRows = defRes.ok
                ? ((await defRes.json()) as Array<{ id: string }>)
                : [];
              const trunkState = defRows[0]?.id
                ? await getAllEnvNodeState(this.env, defRows[0].id)
                : {};
              this.branchCtx = { branchKey, trunkState };
              logger.info("provision.branch_mode", {
                branchKey,
                fromSlug: !row.branch_key,
                trunkNodes: Object.keys(trunkState).length,
              });

              // Config-only nodes (github/resend) get no provision step
              // (buildProvisionPlan skips them), so nothing would ever mark them
              // provisioned in this env — they'd sit at "deploying" forever. They
              // reference the SAME shared repo/email config as trunk, so copy
              // trunk's live state for each into this env up front.
              const branchCanvas = canvasSnapshot as
                | {
                    nodes?: Array<{
                      id: string;
                      type?: string;
                      data?: { provider?: string };
                    }>;
                  }
                | undefined;
              const configNodes = (branchCanvas?.nodes ?? []).filter((n) => {
                const p = n.data?.provider?.toLowerCase();
                return (
                  n.type === "service" && (p === "github" || p === "resend")
                );
              });
              await Promise.all(
                configNodes.map((n) => {
                  const ts = trunkState[n.id];
                  if (ts?.status !== "provisioned") return Promise.resolve();
                  return setEnvNodeState(
                    this.env,
                    environmentId,
                    n.id,
                    ts,
                  ).catch(() => {});
                }),
              );
            }
          }
        } catch (e) {
          logger.warn("provision.branch_ctx_failed", { err: String(e) });
        }
      }

      // Accumulate per-node provider refs for the deployment record.
      const providerRefs: Record<
        string,
        {
          service: string;
          projectId?: string;
          deploymentId?: string;
          workerName?: string;
          versionId?: string;
          runId?: string;
          runUrl?: string;
        }
      > = {};

      // Pre-flight: verify Vercel account has GitHub Login Connection before any provisioning
      if (stack.steps.some((s) => s.service === "vercel")) {
        const vercelToken = await this.getUserToken(userId, "vercel");
        // Extract repo owner from any step that carries an existing_repo — enables org namespace check
        const repoRaw = stack.steps
          .map((s) => (s.params as any)?.existing_repo as string | undefined)
          .find(Boolean);
        const repoForCheck = repoRaw
          ? repoRaw
              .replace(/^https?:\/\/github\.com\//, "")
              .replace(/\.git$/, "")
              .trim()
          : undefined;
        await assertVercelGitHubLinked(vercelToken, repoForCheck);
      }

      // Pre-flight: verify Cloudflare Worker steps carry a linked GitHub repo before any provisioning
      // (no network call needed here — this only checks the repo URL was set on the node;
      // whether the GitHub App is actually installed on that repo is verified later, during provisioning)
      //
      // ONLY the code-deploying "provision" action needs a repo. inject/configure/
      // redeploy steps operate on an already-provisioned worker (pushing env vars or
      // settings) and carry no existing_repo by design — gating them here wrongly
      // blocks redeploys of a fully-provisioned stack.
      const workerStepWithoutRepo = stack.steps.find(
        (s) =>
          s.service === "cloudflare-workers" &&
          s.action === "provision" &&
          !(s.params as any)?.existing_repo,
      );
      if (workerStepWithoutRepo) {
        throw new Error(
          "Your Cloudflare Worker node needs a GitHub repo. Connect a GitHub node with a repository selected to the Worker before deploying.",
        );
      }

      await this.log(
        stackId,
        sessionId,
        "info",
        undefined,
        `Deployment started — ${stack.steps.length} step(s)`,
      );

      // Holds secrets + output URLs in memory — seed with pre-loaded ctx from already-provisioned services
      // Also restore any ctx persisted from a previous crash/eviction of this DO instance
      const savedCtx =
        (await this.state.storage.get<Record<string, string>>(
          `ctx:${stackId}`,
        )) ?? {};
      const ctx: Record<string, string> = {
        ...savedCtx,
        ...(stack.preloadedCtx ?? {}),
      };

      // Idempotent replay: load completed step indices from event log.
      // When use_events=true and a DO restarts mid-provision, skip already-done steps.
      const useEvents = !!(await systemQuery(
        this.env,
        projectId
          ? `projects?id=eq.${projectId}&select=use_events&limit=1`
          : `stacks?id=eq.${stackId}&select=id&limit=1`,
      )
        .then(async (r) => {
          if (!r.ok || !projectId) return false;
          const rows = (await r.json()) as Array<{ use_events?: boolean }>;
          return rows[0]?.use_events ?? false;
        })
        .catch(() => false));

      let completedStepIndices: Set<number> = new Set();
      const completedOutputByIndex = new Map<number, Record<string, unknown>>();
      if (useEvents) {
        const pastEvents = await loadSessionEvents(this.env, sessionId).catch(
          () => [],
        );
        for (const e of pastEvents) {
          if (e.type !== "StepCompleted") continue;
          const idx = e.payload.stepIndex;
          if (typeof idx !== "number") continue;
          completedStepIndices.add(idx);
          const out = e.payload.output;
          if (out && typeof out === "object")
            completedOutputByIndex.set(idx, out as Record<string, unknown>);
        }
      }

      // Set watchdog before step 0 so a hung first step is recoverable.
      await this.state.storage.put<WatchdogState>("watchdog", {
        sessionId,
        stackId,
        workflowId: projectId ?? undefined,
        userId,
      });
      await this.state.storage.setAlarm(Date.now() + 15 * 60 * 1000);

      const loop: StepLoopState = {
        sessionId, stackId, userId, projectId, environmentId,
        stack, ctx, providerRefs, canvasSnapshot, desiredEnvKeysMap,
        completedStepIndices: [...completedStepIndices],
        completedOutputByIndex: [...completedOutputByIndex.entries()],
        useEvents, nextStepIndex: 0, sessionStartedAt,
        deployStartedAt: this.deployStartedAt,
        branchCtx: this.branchCtx,
      };
      const result = await this.runOneStep(loop);
      // 'done' means EITHER a terminal exit (cancel/timeout/terminal
      // failure — those branches inside runOneStep already wrote their own
      // terminal state and cleared stepLoop state, so bail here) OR the
      // last step just succeeded (nextStepIndex reached the end — the
      // existing finalize section immediately below this block, unchanged
      // from before this refactor, still needs to run). Distinguish by
      // whether steps remain — mirrors the same fix Task 2's implementer
      // already had to make to its own (now-removed) while-loop scaffold
      // for the identical reason; see that task's report for the two
      // existing tests this exact bug broke there.
      if (result === 'done' && loop.nextStepIndex < loop.stack.steps.length) {
        return;
      }
      if (result === 'continue') {
        // More steps remain — end THIS invocation and resume via alarm so
        // the next step gets a fresh Workers Free plan subrequest budget.
        return;
      }
      // Falls through to the finalize section below — last step just
      // succeeded, in the SAME invocation as step 0.

      // A cancel that lands after the last step's loop iteration (so the in-loop
      // cancel check never ran) must NOT fall through to a "success" finalize:
      // the cancel handler is the authoritative terminal writer for that case
      // (it already wrote stacks='error' + session='cancelled'). Bailing here
      // keeps the stack/session/project statuses coherent. Mirrors `timedOut`.
      if (this.timedOut || this.cancelled) return;

      if (!this.timedOut && !this.cancelled) {
        await this.finalizeSuccess(loop);
      }
    } catch (err: unknown) {
      await this.finalizeFailure(
        { sessionId, stackId, userId, projectId, stack, sessionStartedAt },
        err,
      );
    }
  }

  // Record a FAILED deploy in project_deployments so the Deployments history
  // shows the attempt (with its error) instead of silently dropping it — only
  // successful deploys were ever recorded before. Rollback stays success-only
  // (it filters status=eq.success), so a failed row can't be rolled back.
  private async recordFailedDeployment(
    stackId: string,
    sessionId: string,
    projectId: string,
    userId: string,
    sessionStartedAt: number,
    environmentId: string | null,
    errorMessage: string,
    canvasSnapshot: unknown,
    providerRefs: unknown,
  ): Promise<void> {
    try {
      const depRes = await systemQuery(this.env, "project_deployments", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          project_id: projectId,
          deployed_by: userId,
          status: "failed",
          started_at: new Date(sessionStartedAt).toISOString(),
          finished_at: new Date().toISOString(),
          error_message: redactSecretsFromText(errorMessage, [
            ...this.secretValues,
          ]),
          canvas_snapshot: canvasSnapshot,
          provider_refs: providerRefs,
          environment_id: environmentId,
        }),
      });
      if (!depRes.ok) {
        createLogger({ session: sessionId, stack: stackId }).warn(
          "provision.failed_deployment_record_failed",
          { status: depRes.status },
        );
      }
    } catch {
      /* recording a failed deploy must never crash teardown */
    }
  }

  private async compensateTeardown(
    stackId: string,
    userId: string,
    sessionId: string,
  ): Promise<void> {
    let resources: Array<{
      service: string;
      nodeId: string;
      resourceId: string;
      created?: boolean;
    }>;
    if (this.createdResources.length > 0) {
      // Same-isolate failure (timeout/fatal/step-failure): the in-memory ledger
      // is authoritative and immune to a dropped StepCompleted event.
      resources = this.createdResources;
    } else {
      // Cross-isolate (watchdog alarm in a fresh isolate): reconstruct from the
      // durable event log.
      try {
        resources = await getProvisionedResources(this.env, stackId);
      } catch (e) {
        this.auditRedacted(userId, "deploy_teardown", {
          stackId,
          removed: 0,
          errors: [
            `getProvisionedResources failed: ${e instanceof Error ? e.message : String(e)}`,
          ],
        });
        return;
      }
    }
    try {
      // Only tear down resources actually created in this run (not reused)
      const toRemove = resources.filter((r) => r.created === true);

      let removed = 0;
      const errors: string[] = [];

      for (const resource of toRemove) {
        try {
          if (resource.service === "vercel") {
            const token = await this.getUserToken(userId, "vercel");
            await deprovisionVercel(token, {
              vercel_project_id: resource.resourceId,
            });
            removed++;
          } else if (resource.service === "supabase") {
            const token = await this.getUserToken(userId, "supabase");
            await deprovisionSupabase(token, {
              supabase_project_ref: resource.resourceId,
            });
            removed++;
          } else if (resource.service === "cloudflare-workers") {
            const token = await this.getUserToken(userId, "cloudflare");
            const accountId = await getAccountId(token, {
              signal: this.abortController.signal,
            });
            await deprovisionCloudflareWorker(
              token,
              accountId,
              resource.resourceId,
            );
            removed++;
          } else if (resource.service === "cloudflare-r2") {
            const token = await this.getUserToken(userId, "cloudflare");
            const accountId = await getAccountId(token, {
              signal: this.abortController.signal,
            });
            await deprovisionR2Bucket(token, accountId, resource.resourceId);
            removed++;
          }
        } catch (e) {
          errors.push(
            `${resource.service}:${resource.resourceId}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      this._emit(
        sessionId,
        stackId,
        "TeardownCompleted",
        { removed, errors, finishedAt: new Date().toISOString() },
        "TeardownCompleted",
      ).catch(() => {});

      this.auditRedacted(userId, "deploy_teardown", {
        stackId,
        removed,
        errors,
      });
    } catch {
      // Teardown itself must never throw — swallow all errors
    }
  }

  /** Cleanup for the top-level timeout path (same isolate — in-memory ledger is
   *  valid). Tears down anything created so far, then clears watchdog/ctx/alarm
   *  and releases the lock. Best-effort throughout. */
  private async handleTimeoutCleanup(
    sessionId: string,
    stackId: string,
    userId: string,
  ): Promise<void> {
    await this.withTimeout(
      this.compensateTeardown(stackId, userId, sessionId),
      60_000,
      "teardown",
    ).catch(() => {});
    const watchdog = await this.state.storage
      .get<WatchdogState>("watchdog")
      .catch(() => undefined);
    if (watchdog?.workflowId) {
      // Record the timed-out attempt in deployment history — this is the single
      // guaranteed terminal writer for the timeout path (runWithSession's own
      // failure branches are gated behind `!this.timedOut`), so it can't double.
      await this.recordFailedDeployment(
        stackId,
        sessionId,
        watchdog.workflowId,
        userId,
        this.deployStartedAt || Date.now(),
        null,
        "Provisioning timed out after 10 minutes",
        {},
        {},
      );
      // watchdog.workflowId IS the projectId (set at start — see runWithSession's
      // `workflowId: projectId`). The success/hard-failure paths write
      // projects.status; the timeout path must too, or the workflow card is left
      // showing a stale 'active'/'draft' after a timed-out deploy.
      await this.updateProjectStatus(watchdog.workflowId, "error").catch(
        () => {},
      );
      await releaseLock(this.env, watchdog.workflowId, watchdog.userId).catch(
        () => {},
      );
    }
    await this.state.storage.delete("watchdog").catch(() => {});
    await this.state.storage.delete(`ctx:${stackId}`).catch(() => {});
    await this.state.storage.deleteAlarm().catch(() => {});
  }

  /** Push a created-resource entry for same-isolate teardown. No-op unless the
   *  step genuinely created a resource (has a resource id and a create action). */
  private recordCreatedResource(
    step: ProvisionStep,
    output: Record<string, unknown>,
  ): void {
    const created =
      step.action !== "inject" &&
      step.action !== "redeploy" &&
      step.action !== "configure";
    if (!created || !step.nodeId) return;
    const resourceId =
      (output.vercel_project_id as string | undefined) ??
      (output.supabase_project_ref as string | undefined) ??
      (output.github_repo_name as string | undefined) ??
      (output.cloudflare_worker_name as string | undefined) ??
      (output.r2_bucket_name as string | undefined) ??
      null;
    if (!resourceId) return;
    this.createdResources.push({
      service: step.service,
      nodeId: step.nodeId,
      resourceId: String(resourceId),
      created: true,
    });
  }

  private async runOneStep(
    loop: StepLoopState,
  ): Promise<"continue" | "done"> {
    const logger = createLogger({
      session: loop.sessionId,
      stack: loop.stackId,
      userId: loop.userId,
    });
    const completedStepIndices = new Set(loop.completedStepIndices);
    const completedOutputByIndex = new Map(loop.completedOutputByIndex);
    const i = loop.nextStepIndex;
    if (Date.now() - loop.deployStartedAt > 10 * 60 * 1000) {
      logger.error("provision.step_loop_deadline_exceeded", {
        deployStartedAt: loop.deployStartedAt,
      });
      await this.handleTimeoutCleanup(loop.sessionId, loop.stackId, loop.userId);
      await this.clearStepLoopState(loop.sessionId);
      return "done";
    }
    {
      if (this.cancelled || this.timedOut) {
        if (!this.timedOut) {
          await this.updateSession(loop.sessionId, "cancelled");
          await this.log(
            loop.stackId,
            loop.sessionId,
            "warn",
            undefined,
            "Deployment cancelled by user",
          );
        }
        await this._emit(loop.sessionId, loop.stackId, "Aborted", {
          stepIndex: i,
        }).catch(() => {});
        await this.state.storage.delete("watchdog");
        await this.state.storage.delete(`ctx:${loop.stackId}`);
        await this.clearStepLoopState(loop.sessionId);
        await this.state.storage.deleteAlarm();
        // Release the canvas lock — every other DO exit path does this, but the
        // graceful-cancel branch previously returned without it, leaking the lock
        // (deleteAlarm above also disables watchdog recovery), leaving the project
        // stuck locked until the 5-minute forceUnlock window.
        if (loop.projectId)
          await releaseLock(this.env, loop.projectId, loop.userId).catch(
            () => {},
          );
        return "done";
      }

      // Skip steps already completed (idempotent replay after DO eviction)
      if (loop.useEvents && completedStepIndices.has(i)) {
        // Re-populate providerRefs from the recorded StepCompleted output so the
        // final project_deployments record isn't missing refs for replayed steps.
        const replayStep = loop.stack.steps[i];
        const replayOut = completedOutputByIndex.get(i);
        if (replayStep.nodeId && replayOut) {
          if (replayStep.service === "vercel") {
            loop.providerRefs[replayStep.nodeId] = {
              service: "vercel",
              projectId: replayOut.vercel_project_id as string | undefined,
              deploymentId: replayOut.vercel_deployment_id as
                | string
                | undefined,
            };
          } else if (replayStep.service === "cloudflare-workers") {
            loop.providerRefs[replayStep.nodeId] = {
              service: "cloudflare-workers",
              workerName: replayOut.cloudflare_worker_name as
                | string
                | undefined,
              versionId: replayOut.cloudflare_worker_version_id as
                | string
                | undefined,
              runId: replayOut.github_run_id as string | undefined,
              runUrl: replayOut.github_run_url as string | undefined,
            };
          }
        }
        logger.info("provision.step.skipped_replay", { step: i });
        loop.nextStepIndex++;
        await this.saveStepLoopState(loop);
        return "continue";
      }

      const step = loop.stack.steps[i];
      logger.info("provision.step.start", { step: i, service: step.service });
      await this.updateStep(loop.sessionId, i, "running");
      await this._emit(
        loop.sessionId,
        loop.stackId,
        "StepStarted",
        {
          stepIndex: i,
          service: step.service,
          nodeId: step.nodeId,
          startedAt: new Date().toISOString(),
        },
        `StepStarted:${i}`,
      );
      await this.log(
        loop.stackId,
        loop.sessionId,
        "info",
        step.service,
        `Step ${i + 1}/${loop.stack.steps.length}: provisioning ${step.nodeLabel ?? step.service}`,
      );

      const MAX_ATTEMPTS = 3;
      let lastErr: string | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const output = await this.executeStep(
            step,
            loop.ctx,
            loop.userId,
            loop.stack.projectName,
            this.abortController.signal,
            `${loop.sessionId}-step${i}`,
            (type, payload, suffix) => {
              this._emit(
                loop.sessionId,
                loop.stackId,
                type,
                payload,
                `${i}:${suffix}`,
              ).catch(() => {});
            },
            loop.canvasSnapshot as
              | {
                  nodes: Array<{ id: string; data: Record<string, unknown> }>;
                  edges: Array<{ source: string; target: string }>;
                }
              | undefined,
          );
          Object.assign(loop.ctx, output);
          this.recordCreatedResource(step, output);
          // Only track values whose key looks secret-shaped — step outputs
          // also include benign identifiers (URLs, worker names, account
          // IDs) that would otherwise get needlessly scrubbed out of later
          // legitimate log lines that happen to mention the same string.
          for (const [key, value] of Object.entries(output)) {
            if (typeof value === "string" && isSecretKey(key)) {
              this.secretValues.add(value);
            }
          }
          // For multi-Supabase canvases: persist per-node ref so postConfigureAuth
          // can configure auth on all projects, not just the last one written to ctx.
          if (step.nodeId && step.service === "supabase") {
            const ref = (output as Record<string, unknown>)
              .supabase_project_ref as string | undefined;
            if (ref) loop.ctx[`supabase_project_ref_${step.nodeId}`] = ref;
          }
          // Collect provider refs for the deployment record
          if (step.nodeId) {
            const stepOut = output as Record<string, unknown>;
            if (step.service === "vercel") {
              loop.providerRefs[step.nodeId] = {
                service: "vercel",
                projectId: stepOut.vercel_project_id as string | undefined,
                deploymentId: stepOut.vercel_deployment_id as
                  | string
                  | undefined,
              };
            } else if (step.service === "cloudflare-workers") {
              loop.providerRefs[step.nodeId] = {
                service: "cloudflare-workers",
                workerName: stepOut.cloudflare_worker_name as
                  | string
                  | undefined,
                versionId: stepOut.cloudflare_worker_version_id as
                  | string
                  | undefined,
                runId: stepOut.github_run_id as string | undefined,
                runUrl: stepOut.github_run_url as string | undefined,
              };
            }
          }
          // Persist ctx after each step so a DO crash/eviction can resume with correct outputs
          await this.state.storage.put(`ctx:${loop.stackId}`, loop.ctx);
          // cachedSteps[i] (status/output) is written once, inside
          // stepCompleteRpc() below, folded into the same Postgres RPC call
          // as the StepCompleted event and success log.
          // Write provisioned resource IDs to env node state and workflows.canvas
          if (step.nodeId) {
            const nodeState = extractEnvNodeState(step.service, output);
            if (Object.keys(nodeState).length > 0) {
              const merged = {
                status: "provisioned",
                provisionedAt: new Date().toISOString(),
                ...nodeState,
              };
              if (loop.environmentId) {
                // Compute desiredEnvKeys BEFORE writing state so it can be folded
                // into the same setEnvNodeState call below (1 subrequest instead
                // of 2 — both writes target the same node-state row). If a
                // framework was just detected, recompute against the canvas with
                // that framework so desired keys are narrowed to the injected
                // prefix (else drift would flag the narrowed-away twins as
                // env_removed).
                const detectedFw = (output as Record<string, string>)
                  .framework;
                if (detectedFw) {
                  const canvas = loop.canvasSnapshot as
                    | {
                        nodes: Array<{
                          id: string;
                          data: Record<string, unknown>;
                        }>;
                        edges: Array<{ source: string; target: string }>;
                      }
                    | undefined;
                  const cNode = canvas?.nodes?.find(
                    (n) => n.id === step.nodeId,
                  );
                  if (cNode) {
                    cNode.data.framework = detectedFw;
                    loop.desiredEnvKeysMap[step.nodeId] =
                      computeDesiredEnvKeys(canvas!, step.nodeId);
                  }
                }
                const desiredEnvKeys = loop.desiredEnvKeysMap[step.nodeId];
                const mergedWithDesired =
                  desiredEnvKeys && desiredEnvKeys.length > 0
                    ? { ...merged, desiredEnvKeys }
                    : merged;
                try {
                  await setEnvNodeState(
                    this.env,
                    loop.environmentId,
                    step.nodeId,
                    mergedWithDesired,
                  );
                } catch (e) {
                  logger.error("provision.set_env_node_state_failed", {
                    nodeId: step.nodeId,
                    error: String(e),
                  });
                  // retry once
                  await setEnvNodeState(
                    this.env,
                    loop.environmentId,
                    step.nodeId,
                    mergedWithDesired,
                  ).catch(() => {});
                }
              }
              if (loop.projectId) {
                try {
                  await patchWorkflowCanvasNodeVersioned(
                    this.env,
                    loop.projectId,
                    step.nodeId,
                    merged,
                  );
                } catch (e) {
                  logger.error("provision.patch_canvas_node_failed", {
                    nodeId: step.nodeId,
                    error: String(e),
                  });
                }
                // No CanvasNodePatched event here (removed 2026-08-02): the
                // canvas write above is the actual effect; nothing ever
                // read this event back (grep-verified), and it cost a full
                // subrequest per step against the same Cloudflare Workers
                // subrequest budget the rest of the deploy shares.
              }
            }
          }
          // Write provisioning_sessions + StepCompleted event + success log
          // in one Postgres RPC call — resource IDs recorded for
          // deprovision/drift replay via the event payload.
          const stepOutput = output as Record<string, unknown>;
          const resourceId =
            stepOutput.vercel_project_id ??
            stepOutput.supabase_project_ref ??
            stepOutput.github_repo_name ??
            stepOutput.cloudflare_worker_name ??
            stepOutput.r2_bucket_name ??
            null;
          await this.stepCompleteRpc(
            loop.sessionId,
            loop.stackId,
            i,
            "success",
            output,
            {
              stepIndex: i,
              service: step.service,
              nodeId: step.nodeId,
              resourceId,
              created:
                step.action !== "inject" &&
                step.action !== "redeploy" &&
                step.action !== "configure",
              output: stepOutput,
              finishedAt: new Date().toISOString(),
            },
            String(i),
            step.service,
            `${step.nodeLabel ?? step.service} provisioned successfully`,
          );
          logger.info("provision.step.success", {
            step: i,
            service: step.service,
            attempt,
          });
          // Reset watchdog. Cleared on success/failure.
          await this.state.storage.put<WatchdogState>("watchdog", {
            sessionId: loop.sessionId,
            stackId: loop.stackId,
            workflowId: loop.projectId ?? undefined,
            userId: loop.userId,
          });
          const isLastStep = i === loop.stack.steps.length - 1;
          if (isLastStep) {
            // After the LAST step all that remains is the (fast) finalize,
            // which runs detached via state.waitUntil AFTER the fetch already
            // returned and can be lost to isolate eviction — stranding the
            // deploy at 'running' with no finalize. Arm a SHORT backstop so an
            // eviction-before-finalize is recovered in ~60s (the alarm
            // reconciles an all-steps-succeeded session to a successful
            // deploy) instead of the full 15 min. A clean finalize deletes
            // this alarm.
            await this.state.storage.setAlarm(Date.now() + 60_000);
          } else {
            // More steps remain. Schedule an alarm to fire immediately so the
            // NEXT step runs in a fresh invocation with its own fresh Workers
            // Free plan subrequest budget, instead of continuing in-process.
            await this.state.storage.setAlarm(Date.now());
          }
          lastErr = undefined;
          break;
        } catch (err: unknown) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (lastErr === "cancelled" || this.cancelled || this.timedOut)
            break;
          logger.warn("provision.step.failed", {
            step: i,
            service: step.service,
            attempt,
            error: lastErr,
          });
          // The subrequest cap is invocation-scoped (Cloudflare Workers Free
          // plan: 50 fetch()es per incoming request, across every step run so
          // far). Once hit, it stays hit for the rest of this invocation —
          // retrying burns the little headroom left before the terminal
          // failure write itself, which needs its own subrequests to land.
          const isSubrequestExhausted = lastErr.includes(
            "Too many subrequests",
          );
          if (isSubrequestExhausted) break;
          if (attempt < MAX_ATTEMPTS) {
            await this.log(
              loop.stackId,
              loop.sessionId,
              "warn",
              step.service,
              `Attempt ${attempt} failed, retrying… (${lastErr})`,
            );
            await this._emit(
              loop.sessionId,
              loop.stackId,
              "StepRetried",
              {
                stepIndex: i,
                service: step.service,
                attempt,
                error: lastErr,
              },
              `StepRetried:${i}:${attempt}`,
            );
            const delay =
              err instanceof RateLimitError
                ? err.waitMs
                : attempt === 1
                  ? 2000
                  : 4000;
            await scheduler.wait(delay);
          }
        }
      }
      if (lastErr !== undefined) {
        if (lastErr === "cancelled" || this.cancelled || this.timedOut) {
          if (!this.timedOut) {
            await this.updateSession(loop.sessionId, "cancelled");
            await this.log(
              loop.stackId,
              loop.sessionId,
              "warn",
              undefined,
              "Deployment cancelled by user",
            );
          }
          await this.state.storage.delete("watchdog");
          await this.state.storage.delete(`ctx:${loop.stackId}`);
          await this.clearStepLoopState(loop.sessionId);
          await this.state.storage.deleteAlarm();
          // Release the canvas lock — every other DO exit path does this. The
          // cancel-during-step branch previously returned without it, leaking the
          // lock until the 5-minute forceUnlock window (deleteAlarm above also
          // disables watchdog recovery).
          if (loop.projectId)
            await releaseLock(this.env, loop.projectId, loop.userId).catch(
              () => {},
            );
          return "done";
        }

        // Configure steps are best-effort: warn and continue rather than fail the deployment
        if (step.action === "configure") {
          await this.log(
            loop.stackId,
            loop.sessionId,
            "warn",
            step.service,
            `Configure skipped (non-fatal): ${lastErr}`,
          );
          await this.updateStep(loop.sessionId, i, "warning", lastErr);
          await this._emit(
            loop.sessionId,
            loop.stackId,
            "StepFailed",
            {
              stepIndex: i,
              service: step.service,
              error: lastErr,
              warning: true,
              finishedAt: new Date().toISOString(),
            },
            `StepFailed:${i}`,
          );
          loop.nextStepIndex++;
          await this.saveStepLoopState(loop);
          return "continue";
        }

        await this.log(
          loop.stackId,
          loop.sessionId,
          "error",
          step.service,
          `Failed after ${MAX_ATTEMPTS} attempts: ${lastErr}`,
        );
        await this.updateStep(loop.sessionId, i, "error", lastErr);
        if (!this.timedOut) {
          await this.updateSession(loop.sessionId, "failed", lastErr);
          await this.updateStatus(loop.stackId, "error");
          if (loop.projectId)
            await this.updateProjectStatus(loop.projectId, "error");
        }
        await this._emit(
          loop.sessionId,
          loop.stackId,
          "StepFailed",
          {
            stepIndex: i,
            service: step.service,
            error: lastErr,
            finishedAt: new Date().toISOString(),
          },
          `StepFailed:${i}`,
        );
        await this._emit(
          loop.sessionId,
          loop.stackId,
          "SessionFailed",
          {
            stepIndex: i,
            error: lastErr,
            finishedAt: new Date().toISOString(),
          },
          "SessionFailed",
        );
        this.auditRedacted(loop.userId, "deploy_failed", {
          stackId: loop.stackId,
          workflowId: loop.projectId ?? null,
          error: lastErr,
          durationMs: Date.now() - loop.sessionStartedAt,
        });
        // Send deploy failure email — fire-and-forget
        this.sendDeployEmail(loop.userId, "failure", {
          projectName: loop.stack.projectName,
          errorMessage: lastErr,
          workflowId: loop.projectId,
          failedService: step.nodeLabel ?? step.service,
        }).catch(() => {});
        await projectSession(this.env, loop.sessionId).catch(() => {});
        // Gate on !timedOut so the timeout-cleanup path stays the single
        // writer when a timeout races this step failure — otherwise both
        // would append a failed row for the same attempt.
        if (loop.projectId && !this.timedOut) {
          await this.recordFailedDeployment(
            loop.stackId,
            loop.sessionId,
            loop.projectId,
            loop.userId,
            loop.sessionStartedAt,
            loop.environmentId,
            lastErr,
            loop.canvasSnapshot,
            loop.providerRefs,
          );
        }
        await this.compensateTeardown(
          loop.stackId,
          loop.userId,
          loop.sessionId,
        ).catch(() => {});
        await this.state.storage.delete("watchdog");
        await this.state.storage.delete(`ctx:${loop.stackId}`);
        await this.clearStepLoopState(loop.sessionId);
        await this.state.storage.deleteAlarm();
        if (loop.projectId)
          await releaseLock(this.env, loop.projectId, loop.userId).catch(
            () => {},
          );
        return "done";
      }
    }

    loop.nextStepIndex++;
    if (loop.nextStepIndex >= loop.stack.steps.length) {
      // Last step just succeeded. The caller (either runWithSession, same
      // invocation, or alarm()'s resumed-loop fast path) still needs to run
      // the finalize section — but it already holds `loop` locally to pass
      // through, so there's no need to keep the persisted stepLoop:* row
      // around for a later re-load. Clear it now rather than leaving it for
      // finalize to own, so a step loop's on-disk footprint never outlives
      // its last actual step.
      await this.clearStepLoopState(loop.sessionId);
      return "done";
    }
    await this.saveStepLoopState(loop);
    return "continue";
  }

  // Runs once every provision step has succeeded. Parameterized on
  // StepLoopState (rather than closing over runWithSession's locals) so it's
  // reachable both from the first invocation (runWithSession, same call as
  // step 0) and from a resumed alarm() invocation when the LAST step happens
  // to run there.
  private async finalizeSuccess(loop: StepLoopState): Promise<void> {
    const logger = createLogger({
      session: loop.sessionId,
      stack: loop.stackId,
      userId: loop.userId,
    });
    // ── Finalize FIRST ──────────────────────────────────────────────────
    // The deploy is SUCCESSFUL the moment every provision step passes. Write
    // the terminal success state BEFORE any best-effort post-work, so a
    // slow/hung post-step (e.g. the Supabase auth API) or an isolate
    // eviction right after the last step can never leave the session stuck
    // at "running" while the resources are already up. This was the root
    // cause of deploys spinning forever with config-only (github/resend)
    // nodes never flipping — they're gated on session success client-side.
    await this.updateStatus(loop.stackId, "ready");
    await this.updateSession(loop.sessionId, "success");
    // Authoritative workflow-card status — independent of any open browser
    // tab. Without this, a deploy that finalizes with no tab watching leaves
    // projects.status stuck at a prior 'error' despite a healthy deploy.
    if (loop.projectId)
      await this.updateProjectStatus(loop.projectId, "active");
    await this._emit(
      loop.sessionId,
      loop.stackId,
      "SessionCompleted",
      {
        finishedAt: new Date().toISOString(),
      },
      "SessionCompleted",
    );
    // Persist config-only (github/resend) node status so a reload keeps them.
    if (loop.projectId) {
      await this.withTimeout(
        markConfigOnlyNodesProvisioned(
          this.env,
          loop.projectId,
          loop.environmentId,
        ),
        30_000,
        "markConfigOnlyNodesProvisioned",
      ).catch(() => {});
    }
    await projectSession(this.env, loop.sessionId).catch(() => {});
    // Watchdog is no longer needed — the session is already terminal. Delete
    // it BEFORE the best-effort work below so a later alarm can't re-mark a
    // now-successful session as failed if that work hangs or the DO is evicted.
    await this.state.storage.delete("watchdog");
    await this.state.storage.delete(`ctx:${loop.stackId}`);
    await this.state.storage.deleteAlarm();
    if (loop.projectId)
      await releaseLock(this.env, loop.projectId, loop.userId).catch(() => {});

    // ── Best-effort post-success work — NEVER blocks the success signal ──
    // Wire Supabase Auth (Vercel URL + Resend SMTP). A hang here used to
    // strand the whole deploy; now it just logs and moves on.
    await this.withTimeout(
      this.postConfigureAuth(loop.sessionId, loop.userId, loop.ctx),
      60_000,
      "postConfigureAuth",
    ).catch((e) => {
      createLogger({ session: loop.sessionId, stack: loop.stackId }).warn(
        "provision.postConfigureAuth_skipped",
        { err: e instanceof Error ? e.message : String(e) },
      );
    });
    // Write deployment map (IDs/URLs only)
    await this.withTimeout(
      this.writeMap(loop.stackId, loop.stack, loop.ctx),
      30_000,
      "writeMap",
    ).catch(() => {});
    // Record in project_deployments so dashboard shows deploy count + last deployed
    if (loop.projectId) {
      const now = new Date().toISOString();
      // Re-read canvas AFTER provisioning so snapshot contains resource IDs (vercelProjectId, etc.)
      let finalCanvas: unknown = loop.canvasSnapshot;
      const fcRes = await systemQuery(
        this.env,
        `projects?id=eq.${loop.projectId}&select=canvas&limit=1`,
      );
      if (fcRes.ok) {
        const rows = (await fcRes.json()) as Array<{ canvas: unknown }>;
        finalCanvas = rows[0]?.canvas ?? loop.canvasSnapshot;
      }
      // Capture env_node_state after provisioning for rollback restore
      let envStateSnapshot: Record<string, unknown> = {};
      if (loop.environmentId) {
        try {
          envStateSnapshot = await getAllEnvNodeState(
            this.env,
            loop.environmentId,
          );
        } catch (e) {
          logger.error("provision.env_snapshot_failed", {
            error: String(e),
          });
        }
      }
      const depRes = await systemQuery(this.env, "project_deployments", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          project_id: loop.projectId,
          deployed_by: loop.userId,
          status: "success",
          started_at: new Date(loop.sessionStartedAt).toISOString(),
          finished_at: now,
          canvas_snapshot: finalCanvas,
          provider_refs: loop.providerRefs,
          env_node_state_snapshot: envStateSnapshot,
          environment_id: loop.environmentId,
        }),
      });
      if (!depRes.ok) {
        logger.warn("provision.deployment_record_failed", {
          status: depRes.status,
        });
      }
    }
    await this.log(
      loop.stackId,
      loop.sessionId,
      "info",
      undefined,
      "Deployment completed successfully",
    );
    logger.info("provision.complete");
    auditLog(this.env, loop.userId, "deploy_completed", {
      stackId: loop.stackId,
      workflowId: loop.projectId ?? null,
      nodeCount: loop.stack.steps.length,
      durationMs: Date.now() - loop.sessionStartedAt,
    });
    // Start incident monitor for provisioned resources
    if (loop.projectId) {
      const vercelProjectId = loop.ctx["vercel_project_id"];
      if (vercelProjectId) {
        provisioningHooks.monitor.start(
          this.env,
          loop.projectId,
          loop.userId,
          "vercel",
          vercelProjectId,
        ).catch(() => {});
      }
      const cfWorkerName = loop.ctx["cloudflare_worker_name"];
      if (cfWorkerName) {
        provisioningHooks.monitor.start(
          this.env,
          loop.projectId,
          loop.userId,
          "cloudflare",
          cfWorkerName,
        ).catch(() => {});
      }
    }
    dispatchWebhooks(this.env, loop.userId, "deploy_succeeded", {
      workflowId: loop.projectId ?? loop.stackId,
      stackId: loop.stackId,
      projectName: loop.stack.projectName,
    }).catch(() => {});
    // Send deploy success email — fire-and-forget
    this.sendDeployEmail(loop.userId, "success", {
      projectName: loop.stack.projectName,
      services: loop.stack.steps.map((s) => s.nodeLabel ?? s.service),
      deployUrl:
        loop.ctx["vercel_project_url"] ??
        loop.ctx["cloudflare_worker_url"] ??
        loop.ctx["supabase_url"],
      workflowId: loop.projectId,
      durationMs: Date.now() - loop.sessionStartedAt,
    }).catch(() => {});
    // Harmless no-op — runOneStep already cleared this on the final step's
    // success (see the tail of runOneStep above). Kept as defense-in-depth.
    await this.clearStepLoopState(loop.sessionId);
  }

  // Runs on any error that escapes runWithSession's try block (or a resumed
  // alarm() invocation's step). Takes the narrower FinalizeFailureIds rather
  // than a full StepLoopState because an error can occur before any
  // StepLoopState is ever built (e.g. the Vercel/GitHub preflight check).
  private async finalizeFailure(
    ids: FinalizeFailureIds,
    err: unknown,
  ): Promise<void> {
    const logger = createLogger({
      session: ids.sessionId,
      stack: ids.stackId,
      userId: ids.userId,
    });
    if (!this.timedOut) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("provision.fatal", { error: msg });
      await this.log(
        ids.stackId,
        ids.sessionId,
        "error",
        undefined,
        `Deployment failed: ${msg}`,
      );
      await this.updateSession(ids.sessionId, "failed", msg);
      await this.updateStatus(ids.stackId, "error");
      if (ids.projectId) await this.updateProjectStatus(ids.projectId, "error");
      await this._emit(
        ids.sessionId,
        ids.stackId,
        "SessionFailed",
        {
          error: msg,
          finishedAt: new Date().toISOString(),
        },
        "SessionFailed",
      ).catch(() => {});
      this.auditRedacted(ids.userId, "deploy_failed", {
        stackId: ids.stackId,
        workflowId: ids.projectId ?? null,
        error: msg,
        durationMs: Date.now() - ids.sessionStartedAt,
      });
      await projectSession(this.env, ids.sessionId).catch(() => {});
      dispatchWebhooks(this.env, ids.userId, "deploy_failed", {
        workflowId: ids.projectId ?? ids.stackId,
        stackId: ids.stackId,
        projectName: ids.stack.projectName,
        error: msg,
      }).catch(() => {});
      // Send deploy failure email — fire-and-forget
      this.sendDeployEmail(ids.userId, "failure", {
        projectName: ids.stack.projectName,
        errorMessage: msg,
        workflowId: ids.projectId,
      }).catch(() => {});
      if (ids.projectId) {
        // canvasSnapshot/providerRefs/environmentId are scoped to the try
        // block above and unreachable here; a failed deploy can't be rolled
        // back anyway, so the snapshots are unnecessary — the error message
        // is what matters for the history row.
        await this.recordFailedDeployment(
          ids.stackId,
          ids.sessionId,
          ids.projectId,
          ids.userId,
          ids.sessionStartedAt,
          null,
          msg,
          {},
          {},
        );
      }
      await this.compensateTeardown(ids.stackId, ids.userId, ids.sessionId).catch(
        () => {},
      );
    }
    await this.state.storage.delete("watchdog");
    await this.state.storage.delete(`ctx:${ids.stackId}`);
    await this.state.storage.deleteAlarm();
    if (ids.projectId)
      await releaseLock(this.env, ids.projectId, ids.userId).catch(() => {});
    // Sole cleanup for the failure path — unlike finalizeSuccess, runOneStep
    // never clears the row early on a failure/cancel/timeout exit.
    await this.clearStepLoopState(ids.sessionId);
  }

  private async executeStep(
    step: ProvisionStep,
    ctx: Record<string, string>,
    userId: string,
    projectName: string,
    cancelSignal?: AbortSignal,
    idempotencyKey?: string,
    emitEvent?: (
      type: EventType,
      payload: Record<string, unknown>,
      suffix: string,
    ) => void,
    canvas?: {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
      edges: Array<{ source: string; target: string }>;
    },
  ): Promise<Record<string, string>> {
    // Build env injection map from ctx for vars this step expects
    const injectedEnv: Record<string, string> = {};
    if (step.injectEnvVars?.length) {
      for (const key of step.injectEnvVars) {
        if (ctx[key] != null && ctx[key] !== "") injectedEnv[key] = ctx[key];
      }
      // Multi-node: prefer the node-scoped ctx value from the github/worker/vercel
      // source actually wired to THIS step over the global last-writer-wins one
      // (mirrors the Supabase connectedSupabaseNodeId override below).
      const scoped = scopedCtxOverrides(
        step.nodeId,
        canvas,
        ctx,
        step.injectEnvVars,
      );
      for (const [k, v] of Object.entries(scoped)) injectedEnv[k] = v;
    }
    // Multi-Supabase: if this step is tied to a specific Supabase node, override
    // the un-suffixed ctx keys (which always reflect node-0) with that node's creds.
    const connectedSbNodeId = (step.params as any)?.connectedSupabaseNodeId as
      | string
      | undefined;
    if (connectedSbNodeId) {
      const SB_KEY_MAP: Record<string, string[]> = {
        supabase_url: [
          "NEXT_PUBLIC_SUPABASE_URL",
          "VITE_SUPABASE_URL",
          "SUPABASE_URL",
        ],
        supabase_anon_key: [
          "NEXT_PUBLIC_SUPABASE_ANON_KEY",
          "VITE_SUPABASE_ANON_KEY",
          "SUPABASE_ANON_KEY",
        ],
        supabase_service_role: ["SUPABASE_SERVICE_ROLE_KEY"],
      };
      for (const [suffix, targets] of Object.entries(SB_KEY_MAP)) {
        const val = ctx[`${suffix}_${connectedSbNodeId}`];
        if (val)
          targets.forEach((t) => {
            injectedEnv[t] = val;
          });
      }
    }
    // Merge user-defined custom env vars (injected into Vercel on top of standard vars)
    const customVars = (step.params as any)?.customEnvVars as
      | Array<{ key: string; value: string }>
      | undefined;
    if (customVars?.length) {
      for (const { key, value } of customVars) {
        if (key && value) injectedEnv[key] = value;
      }
    }
    // Custom vars are user-authored with unpredictable key names, so always
    // track their values regardless of key shape. Everything else (ENV_FLOW
    // aliases like SUPABASE_URL) is only tracked when the key looks
    // secret-shaped — this keeps benign values (public URLs, IDs) out of the
    // redaction set so they don't get needlessly scrubbed from later logs.
    for (const { key, value } of customVars ?? []) {
      if (key && value) this.secretValues.add(value);
    }
    for (const [key, value] of Object.entries(injectedEnv)) {
      if (isSecretKey(key)) this.secretValues.add(value);
    }

    // Inject-only step: for CF Workers, push secrets via API; for others,
    // surface env vars so subsequent redeploy steps can pick them up.
    if (step.action === "inject") {
      if (
        step.service === "cloudflare-workers" &&
        Object.keys(injectedEnv).length > 0
      ) {
        const token = await this.getUserToken(userId, "cloudflare");
        const workerName = (step.params as any)?.cfWorkerNameProvisioned as
          | string
          | undefined;
        if (workerName) {
          const accountId =
            ctx["cloudflare_account_id"] ||
            (await getAccountId(token, {
              signal: this.abortController.signal,
            }));
          try {
            await updateWorkerSecrets(
              token,
              accountId,
              workerName,
              injectedEnv,
              { signal: this.abortController.signal },
            );
            emitEvent?.(
              "SecretInjected",
              {
                service: "cloudflare",
                nodeId: step.nodeId,
                keys: Object.keys(injectedEnv),
              },
              "SecretInjected",
            );
          } catch (secretErr) {
            createLogger().warn("inject.secret_push_failed", {
              nodeId: step.nodeId,
              err: String(secretErr),
            });
          }
        }
      }
      return injectedEnv;
    }

    if (step.action === "configure") {
      if (step.service === "supabase") {
        const token = await this.getUserToken(userId, "supabase");
        const ref = (step.params as any).supabaseProjectRef as string;
        const tables = (step.params as any).tables;
        // CREATE TABLE IF NOT EXISTS (idempotent) — only creates BRAND-NEW
        // tables added to the seed while the node was live; never alters
        // existing tables. The live DB is authoritative on redeploy — column
        // changes are applied via the Database section's live mutations, not
        // by pushing the canvas seed.
        //
        // Non-fatal: once refreshNodeSnapshot has written the live-introspected
        // schema back into node.data.tables, that seed can carry types the
        // editor DDL builder doesn't recognize (e.g. a raw-SQL `inet` column or
        // a `nextval(...)` default), on which buildDDL throws. That must NOT
        // wedge the snapshot refresh below (which lets the diagram self-heal on
        // every load) — existing tables are untouched regardless (IF NOT
        // EXISTS), so the live DB stays safe.
        try {
          await applySupabaseSchema(
            token,
            ref,
            tables,
            this.abortController.signal,
          );
        } catch (e) {
          createLogger().warn("provision.configure_schema_apply_failed", {
            ref,
            nodeId: step.nodeId,
            error: String(e),
          });
        }
        // Snapshot reconciliation is deliberately NOT run here anymore — it
        // used to call refreshNodeSnapshot() synchronously in the deploy's
        // critical path, which introspects the live schema via up to 7
        // parallel Management API calls. On the Workers Free plan's 50
        // subrequest/invocation cap, that made this the single most likely
        // step to blow the budget on a 3-step deploy. The Database page's
        // GET /:projectId/:nodeId/schema route already self-heals any stale
        // snapshot the next time it's opened (see 3fdaebde), so the canvas
        // never stays stale for good — it just isn't guaranteed fresh the
        // instant this deploy finishes.
        return {};
      } else if (step.service === "cloudflare-workers") {
        const token = await this.getUserToken(userId, "cloudflare");
        const workerName = (step.params as any)
          .cfWorkerNameProvisioned as string;
        const envVars = (step.params as any).cfWorkerEnvVars as Record<
          string,
          string
        >;
        const accountId =
          ctx["cloudflare_account_id"] ||
          (await getAccountId(token, { signal: this.abortController.signal }));
        await updateWorkerSecrets(token, accountId, workerName, envVars, {
          signal: this.abortController.signal,
        });
      }
      return {};
    }

    // Redeploy step: inject any new env vars then trigger a new Vercel deployment
    if (step.action === "redeploy") {
      if (step.service === "vercel") {
        const token = await this.getUserToken(userId, "vercel");
        const projectId = (step.params as any).vercelProjectId as
          | string
          | undefined;
        if (!projectId)
          throw new Error(
            "vercelProjectId missing from node data — re-open the Vercel node and re-deploy",
          );

        // Check if the user changed the GitHub repo in the sidebar
        const rawNewRepo = (step.params as any).existing_repo as
          | string
          | undefined;
        const newRepoName = rawNewRepo
          ? rawNewRepo
              .replace(/^https?:\/\/github\.com\//, "")
              .replace(/\.git$/, "")
              .trim()
          : undefined;

        let result: Record<string, string>;

        if (newRepoName) {
          // Fetch currently connected repo — Vercel returns { link: { org, repo } } separately
          const projRes = await fetch(
            `https://api.vercel.com/v9/projects/${projectId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            },
          );
          const proj = projRes.ok
            ? await projRes.json<{
                name: string;
                link?: { repo?: string; org?: string };
              }>()
            : null;
          // Vercel stores org and repo separately — construct full "org/repo" name
          const currentRepo =
            proj?.link?.org && proj?.link?.repo
              ? `${proj.link.org}/${proj.link.repo}`
              : proj?.link?.repo;

          createLogger().info("vercel.redeploy", {
            currentRepo,
            newRepo: newRepoName,
          });

          if (currentRepo !== newRepoName) {
            // Repo changed — relink (delete old project + recreate with new git connection)
            createLogger().info("vercel.relink", {
              from: currentRepo,
              to: newRepoName,
            });
            const out = await relinkVercelWithGitHub(
              token,
              projectId,
              newRepoName,
              injectedEnv,
              idempotencyKey,
            );
            result = out as unknown as Record<string, string>;
          } else {
            if (Object.keys(injectedEnv).length > 0) {
              await injectVercelEnvVars(token, projectId, injectedEnv);
              emitEvent?.(
                "SecretInjected",
                {
                  service: "vercel",
                  nodeId: step.nodeId,
                  keys: Object.keys(injectedEnv),
                },
                "SecretInjected",
              );
            }
            const redeploy1 = await redeployVercel(token, projectId);
            result = {
              vercel_project_url: redeploy1.url,
              vercel_project_id: projectId,
              ...(redeploy1.deploymentId !== undefined
                ? { vercel_deployment_id: redeploy1.deploymentId }
                : {}),
            };
          }
        } else {
          if (Object.keys(injectedEnv).length > 0) {
            await injectVercelEnvVars(token, projectId, injectedEnv);
            emitEvent?.(
              "SecretInjected",
              {
                service: "vercel",
                nodeId: step.nodeId,
                keys: Object.keys(injectedEnv),
              },
              "SecretInjected",
            );
          }
          const redeploy2 = await redeployVercel(token, projectId);
          result = {
            vercel_project_url: redeploy2.url,
            vercel_project_id: projectId,
            ...(redeploy2.deploymentId !== undefined
              ? { vercel_deployment_id: redeploy2.deploymentId }
              : {}),
          };
        }

        // Create GitHub Deployment record
        const repoName =
          newRepoName ??
          (ctx as Record<string, string>).github_repo_name
            ?.replace(/^https?:\/\/github\.com\//, "")
            .replace(/\.git$/, "")
            .trim();
        if (repoName) {
          try {
            const branch =
              (ctx as Record<string, string>).github_default_branch ?? "main";
            await createGitHubDeployment(
              this.env.GITHUB_APP_ID,
              this.env.GITHUB_APP_PRIVATE_KEY,
              repoName,
              branch,
              result.vercel_project_url ?? this.env.FRONTEND_URL,
              this.deployBrand(),
            );
          } catch (e) {
            createLogger().warn("github-app.redeploy_record_skipped", {
              err: (e as Error).message,
            });
          }
        }

        return result;
      }
      return {};
    }

    if (step.service === "vercel") {
      const token = await this.getUserToken(userId, "vercel");

      // Parse GitHub repo name from ctx or Vercel node params (needed up front
      // for the branch-capability probe and for git-branch creation).
      const rawRepo =
        (ctx as Record<string, string>).github_repo_name ||
        (step.params?.existing_repo as string | undefined);
      const parsedRepo = rawRepo
        ? rawRepo
            .replace(/^https?:\/\/github\.com\//, "")
            .replace(/\.git$/, "")
            .replace(/#.*$/, "")
            .trim()
        : undefined;
      const VALID_REPO = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
      const repoName =
        parsedRepo && VALID_REPO.test(parsedRepo) ? parsedRepo : undefined;

      // ── Branch mode ────────────────────────────────────────────────────
      // Native (git-linked): deploy a preview off the branch key — reuses the
      // parent project. Isolated (no link): a separate suffixed Vercel project.
      const branchCtx = this.branchCtx;
      let vercelParams = step.params;
      let vercelProjectName = projectName;
      let branchAlias: string | undefined;
      let branchMode: "native" | "isolated" | undefined;
      if (branchCtx) {
        const decision = await resolveBranchDecision(
          "vercel",
          branchCtx.branchKey,
          { vercelToken: token, vercelRepoName: repoName },
        );
        branchMode = decision.mode;
        if (decision.mode === "native") {
          // Ensure the git branch exists so Vercel has a ref to build a preview.
          if (repoName) {
            try {
              const ghToken = await getInstallationTokenForRepo(
                this.env.GITHUB_APP_ID,
                this.env.GITHUB_APP_PRIVATE_KEY,
                repoName,
              );
              if (ghToken)
                await branchGitHub(ghToken, {
                  repo: repoName,
                  branchKey: branchCtx.branchKey,
                });
            } catch (e) {
              createLogger().warn("branch.github_branch_failed", {
                repo: repoName,
                err: (e as Error).message,
              });
            }
          }
          vercelParams = { ...step.params, branch: branchCtx.branchKey };
          branchAlias = branchCtx.branchKey;
        } else {
          // Isolated: separate project named `<project>-<branchKey>`.
          vercelProjectName = `${projectName}-${branchCtx.branchKey}`;
          vercelParams = {
            ...step.params,
            projectName: vercelProjectName,
            // Never reuse trunk's vercelProjectId for an isolated branch project.
            vercelProjectId: undefined,
          };
          branchAlias = vercelProjectName;
        }
      }

      // ── Framework detection ────────────────────────────────────────────
      // Determines which client env prefix (NEXT_PUBLIC_/VITE_/PUBLIC_) the app
      // reads. Unknown (no repo / no signal) => provisionVercel shotguns all.
      let framework: Framework | undefined;
      let hasWrangler = false;
      if (repoName) {
        try {
          const ghToken = await getInstallationTokenForRepo(
            this.env.GITHUB_APP_ID,
            this.env.GITHUB_APP_PRIVATE_KEY,
            repoName,
          );
          if (ghToken) {
            const rootDir = (step.params as any)?.rootDirectory as
              | string
              | undefined;
            const detected = await detectRepoFramework(
              ghToken,
              repoName,
              rootDir,
            );
            framework = detected.framework;
            hasWrangler = detected.hasWrangler;
            createLogger().info("provision.framework_detected", {
              repo: repoName,
              framework: framework ?? "unknown",
              hasWrangler,
            });
            if (!framework) {
              // Repo readable but no framework signal (config file + package.json
              // both silent). Falls back to shotgun-all-prefixes — record why so
              // "why are there VITE_/PUBLIC_ twins?" is answerable from logs.
              createLogger().warn("provision.framework_undetected", {
                repo: repoName,
                reason: "no_signal",
                rootDir: rootDir ?? null,
              });
            }
          } else {
            // repoName is set but the GitHub App has no installation token for it
            // (app not installed / lacks contents:read). Detection can't run at
            // all → shotgun. This was previously silent.
            createLogger().warn("provision.framework_undetected", {
              repo: repoName,
              reason: "github_app_not_installed",
            });
          }
        } catch (e) {
          createLogger().warn("provision.framework_detect_failed", {
            repo: repoName,
            err: (e as Error).message,
          });
        }
      }

      const out = await provisionVercel(
        token,
        vercelProjectName,
        ctx,
        { ...vercelParams, framework },
        injectedEnv,
        idempotencyKey,
      );
      const result = out as unknown as Record<string, string>;
      if (framework) result.framework = framework;
      if (hasWrangler) result.has_wrangler = "true";
      // ENV_FLOW: vercel → cloudflare-workers promises ALLOWED_ORIGIN/FRONTEND_URL
      // (CORS / redirect config). Not public bases — injected verbatim into the
      // Worker. Emit them off the just-provisioned Vercel URL so a connected
      // Worker step downstream can read them from ctx.
      if (result.vercel_project_url) {
        result.ALLOWED_ORIGIN = result.vercel_project_url;
        result.FRONTEND_URL = result.vercel_project_url;
      }
      if (branchCtx) {
        result.branch_key = branchCtx.branchKey;
        if (branchMode) result.branch_mode = branchMode;
        if (branchAlias) result.vercel_branch_alias = branchAlias;
      }

      if (repoName) {
        const branch =
          branchCtx?.branchKey ??
          (ctx as Record<string, string>).github_default_branch ??
          "main";
        try {
          // Use GitHub App only — no user-token fallback (avoids committing on user's behalf).
          // These are best-effort side effects that run INLINE in the provision
          // step, so they must never strand the deploy: each ghFetch is bounded
          // (30s), and the whole block is bounded again here so their sum can't
          // block finalize/SessionCompleted — which is what leaves config-only
          // GitHub nodes stuck at DRAFT.
          await this.withTimeout(
            (async () => {
              const brand = this.deployBrand();
              await pushLeenarCommitAsApp(
                this.env.GITHUB_APP_ID,
                this.env.GITHUB_APP_PRIVATE_KEY,
                repoName,
                brand,
              );
              await createGitHubDeployment(
                this.env.GITHUB_APP_ID,
                this.env.GITHUB_APP_PRIVATE_KEY,
                repoName,
                branch,
                result.vercel_project_url ?? this.env.FRONTEND_URL,
                brand,
              );
            })(),
            45_000,
            "github-app.provisionSteps",
          );
        } catch (e) {
          createLogger().warn("github-app.provision_steps_skipped", {
            err: (e as Error).message,
          });
        }
      }

      return result;
    }

    if (step.service === "supabase") {
      const token = await this.getUserToken(userId, "supabase");
      const branch = this.branchCtx;
      const tables = (step.params as any)?.tables;
      // Supabase is ALWAYS isolated on a branch (schema-clone). Suffix the
      // project name with the branch key and re-apply the authored schema; the
      // source ref (trunk's live supabaseProjectRef) is used only for optional
      // data seeding.
      const baseName = (step.params as any)?.projectName ?? projectName;
      const sbProjectName = branch
        ? `${baseName}-${branch.branchKey}`
        : baseName;
      const out = branch
        ? await cloneSupabase(
            token,
            {
              projectName: sbProjectName,
              region: (step.params as any)?.region,
              tables: Array.isArray(tables) ? tables : [],
              sourceRef:
                (step.nodeId &&
                  branch.trunkState[step.nodeId]?.supabaseProjectRef) ||
                undefined,
              seedData: Boolean(
                step.nodeId && branch.trunkState[step.nodeId]?.seedData,
              ),
            },
            cancelSignal,
          )
        : await provisionSupabase(
            token,
            sbProjectName,
            step.params,
            cancelSignal,
          );
      const result: Record<string, string> = out as unknown as Record<
        string,
        string
      >;
      if (branch) {
        result.branch_mode = "isolated";
        result.branch_key = branch.branchKey;
        result.supabase_clone_ref = out.supabase_project_ref;
      }
      // Carry email delivery config into ctx so postConfigureAuth can use it
      if (step.params?.fromEmail)
        result.resend_from_email = step.params.fromEmail as string;
      if (step.params?.senderName)
        result.resend_sender_name = step.params.senderName as string;

      // cloneSupabase already applied the schema; only the non-branch path needs
      // to apply it here.
      if (Array.isArray(tables) && tables.length > 0) {
        try {
          if (!branch)
            await applySupabaseSchema(
              token,
              out.supabase_project_ref,
              tables,
              cancelSignal,
            );
        } catch (schemaErr) {
          // Schema apply failure is best-effort — the project is already up, so
          // we don't fail the whole deploy. But it must NOT be a silent green:
          // a server-only log left the user with a "successful" deploy and an
          // empty DB (app 500s at runtime). Surface a user-facing Warning so the
          // missing tables are visible — mirrors the R2 credentials-pending
          // warning and the configure-step warning path.
          createLogger().warn("provision.supabase_schema_failed", {
            err: (schemaErr as Error).message,
            ref: out.supabase_project_ref,
          });
          emitEvent?.(
            "Warning",
            {
              nodeId: step.nodeId,
              message:
                `Supabase project provisioned, but applying the database schema failed ` +
                `(${(schemaErr as Error).message}). Your tables were NOT created — ` +
                `re-run the deploy or apply the schema manually before using the app.`,
            },
            "SupabaseSchemaFailed",
          );
        }
      }

      return result;
    }

    if (step.service === "cloudflare-workers") {
      // 1. Resolve the repo — step.params.existing_repo is guaranteed present
      // by the preflight (Task 5); normalize it the same way the Vercel step does.
      const rawRepo = (step.params as any)?.existing_repo as string | undefined;
      const parsedRepo = rawRepo
        ? rawRepo
            .replace(/^https?:\/\/github\.com\//, "")
            .replace(/\.git$/, "")
            .replace(/#.*$/, "")
            .trim()
        : undefined;
      const VALID_REPO = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
      const repoName =
        parsedRepo && VALID_REPO.test(parsedRepo) ? parsedRepo : undefined;
      if (!repoName) {
        throw new Error(
          `Cloudflare Worker step has an invalid or missing GitHub repo ("${rawRepo ?? ""}"). Connect a GitHub node with a valid repository to the Worker before deploying.`,
        );
      }

      // 2. Get a GitHub App installation token for this repo.
      const ghToken = await getInstallationTokenForRepo(
        this.env.GITHUB_APP_ID,
        this.env.GITHUB_APP_PRIVATE_KEY,
        repoName,
      );
      if (!ghToken) {
        throw new Error(
          `The Leenar GitHub App is not installed on ${repoName}. Install the GitHub App on this repo before deploying the Worker.`,
        );
      }

      // 2b. Resolve the repo's actual default branch ONCE via the GitHub API —
      // used for both the workflow-file write (implicitly, since GitHub commits
      // to the repo's real default branch) and the dispatch call below. Do NOT
      // fall back to ctx.github_default_branch ?? "main": that ctx value is only
      // populated when GitHub was freshly provisioned in this same run, so for an
      // already-connected repo it's silently absent and dispatch would target the
      // wrong branch.
      const { default_branch: defaultBranch } = await verifyRepo(
        ghToken,
        repoName,
      );

      // ── Branch namespacing (native) ──────────────────────────────────────
      // On a branch deploy the Worker MUST be a separate resource, or wrangler
      // would overwrite the trunk Worker (same name from wrangler.toml). We:
      //   (1) ensure the git branch exists (idempotent),
      //   (2) deploy with `--name <base>-<branchKey>` so it's distinct,
      //   (3) build from the branch ref (dispatch + workflow write on branchKey).
      const cfBranch = this.branchCtx;
      let workerNameOverride: string | undefined;
      const deployRef = cfBranch ? cfBranch.branchKey : defaultBranch;
      if (cfBranch) {
        try {
          await branchGitHub(ghToken, {
            repo: repoName,
            fromBranch: defaultBranch,
            branchKey: cfBranch.branchKey,
          });
        } catch (e) {
          throw new Error(
            `Failed to create git branch "${cfBranch.branchKey}" for the Worker deploy: ${(e as Error).message}`,
          );
        }
        let base: string | null = null;
        try {
          base = await getWranglerWorkerName(ghToken, repoName);
        } catch {
          /* fall back below */
        }
        base =
          base ||
          `${projectName}-worker`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .slice(0, 63);
        workerNameOverride = `${base}-${cfBranch.branchKey}`.slice(0, 63);
      }

      // 3. Set the two CF secrets on the repo (flow into wrangler-action via `secrets.*`).
      const cfToken = await this.getUserToken(userId, "cloudflare");
      const accountId =
        ctx["cloudflare_account_id"] ||
        (await getAccountId(cfToken, { signal: this.abortController.signal }));
      await putRepoActionsSecret(
        ghToken,
        repoName,
        "CLOUDFLARE_API_TOKEN",
        cfToken,
      );
      await putRepoActionsSecret(
        ghToken,
        repoName,
        "CLOUDFLARE_ACCOUNT_ID",
        accountId,
      );

      // 4. Write the deploy workflow file. Lets missing-wrangler-config errors
      // propagate — fail fast rather than dispatching a workflow doomed to fail.
      const workflowWritten = await writeWorkflowFileAsApp(
        this.env.GITHUB_APP_ID,
        this.env.GITHUB_APP_PRIVATE_KEY,
        repoName,
        cfBranch
          ? { workerName: workerNameOverride, branch: cfBranch.branchKey }
          : undefined,
      );
      if (!workflowWritten) {
        throw new Error(
          `Failed to write the Leenar deploy workflow to ${repoName}. Check the GitHub App has write access to repo contents and try again.`,
        );
      }

      // 5. Dispatch the workflow — but only if this exact step attempt hasn't
      // already dispatched one. The outer MAX_ATTEMPTS retry loop re-runs this
      // whole step body from scratch on any thrown error (e.g. a transient
      // findWorkflowRun failure during polling below); without this marker a
      // retry after a successful dispatch would fire a second concurrent
      // `wrangler deploy`. The marker is keyed per-node.
      //
      // It is ALSO persisted to durable storage: if the DO is evicted mid-poll
      // (the step dispatched but never wrote its StepCompleted event) and
      // idempotent replay re-runs this step, in-memory `ctx` is gone (ctx is
      // only persisted after a step succeeds), so a ctx-only marker would let
      // replay fire a second concurrent deploy. The DO is named by stackId, so
      // this storage is scoped to THIS deploy attempt — a fresh redeploy is a
      // new DO with empty storage, no stale-marker leak.
      const workflowFile = "leenar-deploy.yml";
      const dispatchMarkerKey = `_cf_workflow_dispatched_at_${step.nodeId}`;
      const dispatchStorageKey = `dispatch:${step.nodeId}`;
      let dispatchedAfter: string | undefined = ctx[dispatchMarkerKey];
      if (!dispatchedAfter) {
        dispatchedAfter = await this.state.storage
          .get<string>(dispatchStorageKey)
          .catch(() => undefined);
      }
      if (!dispatchedAfter) {
        // Capture the timestamp immediately before dispatching so findWorkflowRun
        // can correlate by `created > dispatchedAfter`.
        dispatchedAfter = new Date().toISOString();
        await dispatchWorkflow(ghToken, repoName, workflowFile, deployRef, {
          signal: this.abortController.signal,
        });
        // Set BEFORE polling begins, so a later throw in the poll loop below is
        // recoverable on retry without re-dispatching — in-memory for the
        // same-isolate retry loop, and durably for a cross-isolate replay.
        ctx[dispatchMarkerKey] = dispatchedAfter;
        await this.state.storage
          .put(dispatchStorageKey, dispatchedAfter)
          .catch(() => {});
      }

      // 6. Poll until the run reaches a terminal state. Respect the DO's abort
      // signal on every iteration (the loop itself must exit — not just fetches).
      // 15s interval + an explicit attempt cap (40 × 15s = 10min, matching the
      // outer DO timeout so no legitimate wait time is lost) — each poll is a
      // Cloudflare subrequest and the whole DO session shares one subrequest
      // budget across every step, so an unbounded 5s-interval loop alone could
      // exhaust it before the run even finishes.
      const POLL_INTERVAL_MS = 15000;
      const MAX_POLL_ATTEMPTS = 40;
      let run: {
        id: number;
        status: string;
        conclusion: string | null;
        html_url: string;
      } | null = null;
      for (let pollAttempt = 0; pollAttempt < MAX_POLL_ATTEMPTS; pollAttempt++) {
        if (this.abortController.signal.aborted) {
          throw new Error(
            `Cloudflare Worker deploy for ${repoName} was aborted before the GitHub Actions run completed.`,
          );
        }
        // Re-querying the workflow's runs list (rather than a single-run GET)
        // is deliberate: it re-uses the same created>dispatchedAfter correlation
        // as the initial lookup, so a stale/mismatched run id can never be polled.
        run = await findWorkflowRun(
          ghToken,
          repoName,
          workflowFile,
          dispatchedAfter,
        );
        if (run && run.status === "completed") break;
        await scheduler.wait(POLL_INTERVAL_MS);
      }
      if (!run || run.status !== "completed") {
        throw new Error(
          `Cloudflare Worker deploy for ${repoName} did not complete via GitHub Actions within ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 60000} minutes.`,
        );
      }

      // 7. On completion: derive the URL on success, or pull a diagnostic
      // tail from check-run annotations on failure.
      if (run.conclusion !== "success") {
        const tail = await getWorkflowRunFailureTail(ghToken, repoName, run.id);
        throw new Error(
          `Cloudflare Worker deploy failed via GitHub Actions (run ${run.html_url}): ${tail}`,
        );
      }

      // For a branch deploy the deployed Worker name is exactly the override we
      // passed to wrangler — use it directly (reading wrangler.toml would return
      // the trunk name). Otherwise derive it from the repo's wrangler config.
      let workerName: string | null = workerNameOverride ?? null;
      if (!workerName) {
        try {
          workerName = await getWranglerWorkerName(ghToken, repoName);
        } catch (e) {
          createLogger().warn("cloudflare-workers.name_derivation_failed", {
            repoName,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
      if (!workerName) {
        workerName =
          ((step.params as any)?.cfWorkerName as string | undefined) ||
          `${projectName}-worker`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "-")
            .slice(0, 63);
      }

      const subdomain = await getWorkersSubdomain(cfToken, accountId, {
        signal: this.abortController.signal,
      }).catch(() => "");
      const workerUrl = subdomain
        ? `https://${workerName}.${subdomain}.workers.dev`
        : `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}`;

      const result: Record<string, string> = {
        cloudflare_account_id: accountId,
        cloudflare_worker_name: workerName,
        cloudflare_worker_url: workerUrl,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_WORKER_NAME: workerName,
        CLOUDFLARE_WORKER_URL: workerUrl,
        // ENV_FLOW: cloudflare-workers → vercel promises API_URL/WORKER_URL.
        // These are PUBLIC_ENV_BASES — also emit the NEXT_PUBLIC_ twin so the
        // Vercel connector's PUBLIC_VALUE_ALIASES can re-resolve to the target
        // framework's prefix. Without this the frontend can't reach its backend.
        API_URL: workerUrl,
        WORKER_URL: workerUrl,
        NEXT_PUBLIC_API_URL: workerUrl,
        NEXT_PUBLIC_WORKER_URL: workerUrl,
        github_run_id: String(run.id),
        github_run_url: run.html_url,
      };
      if (cfBranch) {
        result.branch_mode = "native";
        result.branch_key = cfBranch.branchKey;
        result.github_branch = cfBranch.branchKey;
      }

      return result;
    }

    if (step.service === "cloudflare-r2") {
      const token = await this.getUserToken(userId, "cloudflare");
      const accountId =
        ctx["cloudflare_account_id"] ||
        (await getAccountId(token, { signal: this.abortController.signal }));
      const baseBucketName =
        ((step.params as any)?.cfBucketName as string | undefined) ||
        `${projectName}-bucket`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-")
          .slice(0, 63);
      // Cloudflare R2 is always native-namespaced on a branch: `<name>-<key>`.
      // provisionR2 re-slugifies and truncates to 63 chars, so the suffix is
      // safe to append here.
      const bucketName = this.branchCtx
        ? `${baseBucketName}-${this.branchCtx.branchKey}`
        : baseBucketName;
      const locationHint = (step.params as any)?.cfLocationHint as
        | string
        | undefined;
      const r2Out = (await provisionR2(token, accountId, bucketName, {
        locationHint,
        signal: this.abortController.signal,
      })) as unknown as Record<string, string>;
      if (this.branchCtx) {
        r2Out.branch_mode = "native";
        r2Out.branch_key = this.branchCtx.branchKey;
      }
      if (r2Out.r2_credentials_pending) {
        // Only warn about manual R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY env vars when
        // there's a real downstream consumer that actually needs them as env vars
        // (a Vercel node wired via an edge). No edge → nothing to warn about. An edge
        // to a Cloudflare Worker uses native wrangler.toml bindings, not env vars, so
        // the advice would be wrong there. Any other target service isn't covered by
        // ENV_FLOW's cloudflare-r2 rules, so treat it the same as "no consumer".
        const targetEdge = canvas?.edges?.find(
          (edge) => edge.source === step.nodeId,
        );
        const targetNode = targetEdge
          ? canvas?.nodes?.find((n) => n.id === targetEdge.target)
          : undefined;
        const targetService = targetNode
          ? inferServiceKey(targetNode.data)
          : null;
        if (targetEdge && targetService === "vercel") {
          const targetLabel =
            typeof targetNode?.data?.label === "string" && targetNode.data.label
              ? (targetNode.data.label as string)
              : "Vercel";
          emitEvent?.(
            "Warning",
            {
              nodeId: step.nodeId,
              message:
                `R2 bucket "${r2Out.r2_bucket_name}" created. ` +
                `Go to Cloudflare R2 → Manage R2 API Tokens, create a token for this bucket, ` +
                `then add R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY as env vars in your ${targetLabel} project.`,
            },
            "R2CredentialsPending",
          );
        }
      }
      return r2Out as unknown as Record<string, string>;
    }

    throw new Error(`Unknown service: ${step.service}`);
  }

  private async getUserToken(userId: string, service: string): Promise<string> {
    const ALLOWED_SERVICES = new Set([
      "github",
      "vercel",
      "supabase",
      "resend",
      "cloudflare",
    ]);
    if (!ALLOWED_SERVICES.has(service))
      throw new Error(`Unknown service: ${service}`);
    const res = await systemQuery(
      this.env,
      `user_connections?user_id=eq.${userId}&service=eq.${service}&select=access_token_enc,refresh_token_enc,expires_at&limit=1`,
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Failed to fetch ${service} connection (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const rows = (await res.json()) as Array<{
      access_token_enc: string;
      refresh_token_enc: string | null;
      expires_at: string | null;
    }>;
    if (!rows.length)
      throw new Error(
        `No ${service} connection found. Connect your account in Settings first.`,
      );

    const row = rows[0];
    const isExpired = row.expires_at
      ? new Date(row.expires_at) <= new Date(Date.now() + 60_000)
      : false;

    // Attempt token refresh if expired and we have a refresh token
    if (isExpired) {
      if (row.refresh_token_enc) {
        try {
          const refreshed = await this.refreshToken(
            userId,
            service,
            row.refresh_token_enc,
          );
          if (refreshed) {
            this.secretValues.add(refreshed);
            return refreshed;
          }
        } catch {
          /* fall through to the clear error below */
        }
      }
      // Expired and un-refreshable: the provider has no refresh flow (only
      // Supabase does today), there is no refresh token, or the refresh call
      // failed. Returning the known-dead access token would make this step fire
      // a costly/destructive API call that 401s with an opaque provider error
      // ("Not authorized") and retries 3× on a permanently-dead credential.
      // Fail fast with an actionable message instead.
      throw new Error(
        `Your ${service} connection has expired. Reconnect ${service} in Settings, then redeploy.`,
      );
    }

    const token = await decrypt(row.access_token_enc, this.env.ENCRYPTION_KEY);
    this.secretValues.add(token);
    return token;
  }

  private async refreshToken(
    userId: string,
    service: string,
    refreshTokenEnc: string,
  ): Promise<string | null> {
    const refreshToken = await decrypt(
      refreshTokenEnc,
      this.env.ENCRYPTION_KEY,
    );

    let newAccessToken: string | undefined;
    let newRefreshToken: string | undefined;
    let newExpiresIn: number | undefined;

    if (service === "supabase") {
      const credentials = btoa(
        `${this.env.SUPABASE_CLIENT_ID}:${this.env.SUPABASE_CLIENT_SECRET}`,
      );
      const res = await fetch("https://api.supabase.com/v1/oauth/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
      newAccessToken = data.access_token;
      newRefreshToken = data.refresh_token;
      newExpiresIn = data.expires_in;
    }

    if (!newAccessToken) return null;

    const encAccess = await encrypt(newAccessToken, this.env.ENCRYPTION_KEY);
    const encRefresh = newRefreshToken
      ? await encrypt(newRefreshToken, this.env.ENCRYPTION_KEY)
      : undefined;
    const expiresAt = newExpiresIn
      ? new Date(Date.now() + newExpiresIn * 1000).toISOString()
      : undefined;

    const patchRes = await systemQuery(
      this.env,
      `user_connections?user_id=eq.${userId}&service=eq.${service}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          access_token_enc: encAccess,
          ...(encRefresh ? { refresh_token_enc: encRefresh } : {}),
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        }),
      },
    );
    if (!patchRes.ok)
      throw new Error(`token persist failed: ${patchRes.status}`);

    return newAccessToken;
  }

  // Scrubs known secret values out of every free-text string field before
  // handing metadata to the shared auditLog() helper — auditLog only redacts
  // by key name, so it can't catch a secret value echoed back inside a
  // provider's error message, regardless of which field it ends up under.
  private auditRedacted(
    userId: string,
    event: string,
    metadata: Record<string, unknown>,
  ) {
    const secrets = [...this.secretValues];
    const scrub = (value: unknown): unknown => {
      if (typeof value === "string")
        return redactSecretsFromText(value, secrets);
      if (Array.isArray(value)) return value.map(scrub);
      if (value !== null && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [
            k,
            scrub(v),
          ]),
        );
      }
      return value;
    };
    auditLog(
      this.env,
      userId,
      event,
      scrub(metadata) as Record<string, unknown>,
    );
  }

  // ── Supabase helpers (service role, no RLS needed) ────────────

  private async log(
    stackId: string,
    sessionId: string,
    level: "info" | "warn" | "error",
    service: string | undefined,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await systemQuery(this.env, "deployment_logs", {
        method: "POST",
        body: JSON.stringify({
          stack_id: stackId,
          session_id: sessionId,
          level,
          service: service ?? null,
          message: redactSecretsFromText(message, [...this.secretValues]),
          metadata: redactPayload(metadata ?? {}),
        }),
      });
    } catch {
      /* log failure must never crash provisioning */
    }
  }

  private async createSession(
    stackId: string,
    steps: ProvisionStep[],
  ): Promise<string> {
    this.cancelled = false;
    this.timedOut = false;
    this.abortController = new AbortController();
    this.secretValues.clear();
    this.createdResources = [];
    await systemQuery(this.env, "stacks?id=eq." + stackId, {
      method: "PATCH",
      body: JSON.stringify({ status: "provisioning" }),
    });

    const initialSteps: ProvisionStepRecord[] = steps.map((s) => ({
      name: s.nodeLabel ?? s.service,
      nodeId: s.nodeId,
      status: "pending",
    }));
    this.cachedSteps = initialSteps;

    const res = await systemQuery(this.env, "provisioning_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" } as HeadersInit,
      body: JSON.stringify({
        stack_id: stackId,
        total_steps: steps.length,
        steps: initialSteps,
        status: "running",
      }),
    });
    const rows = (await res.json()) as Array<{ id: string }>;
    if (!rows[0]?.id)
      throw new Error("provisioning_sessions INSERT returned no row");
    return rows[0].id;
  }

  private async postConfigureAuth(
    sessionId: string,
    userId: string,
    ctx: Record<string, string>,
  ): Promise<void> {
    // Collect all Supabase project refs: per-node keys written during provision loop,
    // plus the plain key for single-Supabase backwards compat. Dedup via Set.
    const refs = new Set<string>();
    if (ctx.supabase_project_ref) refs.add(ctx.supabase_project_ref);
    for (const [k, v] of Object.entries(ctx)) {
      if (k.startsWith("supabase_project_ref_") && v) refs.add(v);
    }

    if (refs.size === 0) return; // no Supabase in this stack

    // Resolve the app's public URL for Supabase Auth (site_url + redirect
    // allow-list). Prefer the connected Vercel frontend; fall back to a
    // Cloudflare Worker that serves the app. Only when NO
    // frontend is wired does this stay undefined — then configureSupabaseAuth
    // leaves Supabase's default (http://localhost:3000) untouched.
    const siteUrl =
      ctx.vercel_project_url ||
      ctx.FRONTEND_URL ||
      ctx.WORKER_URL ||
      ctx.API_URL ||
      undefined;

    // Try to get Resend token — silently skip if user hasn't connected Resend.
    // resend_smtp_enabled is set by workflowProvision when a Resend→Supabase edge exists.
    // We also fall back to checking resend_from_email for backwards compat.
    let resendToken: string | undefined;
    if (ctx.resend_smtp_enabled === "true" || ctx.resend_from_email) {
      try {
        resendToken = await this.getUserToken(userId, "resend");
      } catch {
        /* not connected */
      }
    }

    // Fetch once outside the loop — same user/service for all refs, and fetching
    // inside the loop risks a refresh race where the second iteration reads a stale
    // ciphertext after the first iteration already refreshed and re-encrypted the token.
    let supabaseToken: string;
    try {
      supabaseToken = await this.getUserToken(userId, "supabase");
    } catch (err) {
      createLogger().error("provision.postConfigureAuth_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    for (const ref of refs) {
      try {
        await configureSupabaseAuth(supabaseToken, ref, {
          siteUrl: siteUrl,
          smtpHost: resendToken ? "smtp.resend.com" : undefined,
          smtpPass: resendToken,
          smtpSenderEmail: resendToken
            ? ctx.resend_from_email || undefined
            : undefined,
          smtpSenderName: resendToken
            ? ctx.resend_sender_name || undefined
            : undefined,
        });
        // Record as a synthetic "auth-config" step in the session
        this.cachedSteps.push({
          name: "Supabase Auth",
          status: "success",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          output: {
            auth_url: `https://${ref}.supabase.co/auth/v1`,
            site_url: siteUrl ?? "",
            smtp_configured: resendToken ? "yes" : "no",
          },
        });
        await systemQuery(this.env, "provisioning_sessions?id=eq." + sessionId, {
          method: "PATCH",
          body: JSON.stringify({ steps: this.cachedSteps }),
        });
      } catch (err) {
        // Auth config is best-effort — don't fail the whole provision
        createLogger().error("provision.postConfigureAuth_failed", {
          ref,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async saveStepLoopState(state: StepLoopState): Promise<void> {
    await this.state.storage.put(`stepLoop:${state.sessionId}`, state);
  }

  private async loadStepLoopState(
    sessionId: string,
  ): Promise<StepLoopState | undefined> {
    return this.state.storage.get<StepLoopState>(`stepLoop:${sessionId}`);
  }

  private async clearStepLoopState(sessionId: string): Promise<void> {
    await this.state.storage.delete(`stepLoop:${sessionId}`);
  }

  private async updateSession(
    sessionId: string,
    status: string,
    errorMessage?: string,
  ) {
    const body = JSON.stringify({
      status,
      ...(status !== "running"
        ? { finished_at: new Date().toISOString() }
        : {}),
      // A "failed" session must always carry a human-readable error — otherwise
      // error_message ends up null even though the deploy genuinely failed.
      ...(status === "failed"
        ? {
            error_message:
              errorMessage ?? "Provisioning failed (no error detail captured)",
          }
        : errorMessage
          ? { error_message: errorMessage }
          : {}),
    });

    const MAX_ATTEMPTS = 3;
    let lastErr: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await systemQuery(
          this.env,
          "provisioning_sessions?id=eq." + sessionId,
          {
            method: "PATCH",
            body,
          },
        );
        if (res.ok) return;
        lastErr = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    // Never throw here — this is called from the caller's own catch block
    // (the top-level `.catch` in fetch()), so throwing would re-enter it and
    // could mask the original error or loop. Log and move on; the session
    // is left in whatever state it last successfully reached.
    createLogger({ session: sessionId }).error(
      "provision.updateSession_persist_failed",
      { status, error: lastErr },
    );
  }

  /** In-memory-only mutation of this.cachedSteps — no network call. Split out
   *  of updateStep so the step-success path can fold the resulting write into
   *  the single stepCompleteRpc() round trip instead of a separate PATCH. */
  private mutateCachedStep(
    index: number,
    status: string,
    error?: string,
    output?: Record<string, string>,
  ) {
    if (!this.cachedSteps[index])
      this.cachedSteps[index] = { name: "", status: "pending" };
    this.cachedSteps[index].status = status;
    if (status === "running")
      this.cachedSteps[index].started_at = new Date().toISOString();
    if (status !== "running")
      this.cachedSteps[index].finished_at = new Date().toISOString();
    if (error) this.cachedSteps[index].error = error;
    if (output) {
      // Strip secrets before persisting — full output (with keys) stays in-memory ctx for env injection
      const SENSITIVE_KEYS = new Set([
        "supabase_service_role",
        "supabase_anon_key",
        "supabase_service_role_key",
        "next_public_supabase_anon_key",
        "access_token",
        "resend_api_key",
        "r2_secret_access_key",
        "r2_access_key_id",
      ]);
      this.cachedSteps[index].output = Object.fromEntries(
        Object.entries(output).filter(
          ([k]) => !SENSITIVE_KEYS.has(k.toLowerCase()),
        ),
      );
    }
  }

  private async updateStep(
    sessionId: string,
    index: number,
    status: string,
    error?: string,
    // Optional: fold a step-success output write into this same PATCH
    // (1 Cloudflare subrequest instead of 2 — output+status target the
    // same provisioning_sessions.steps column, so there's no reason to
    // split them across two round trips against the same DO invocation's
    // shared subrequest budget).
    output?: Record<string, string>,
  ) {
    this.mutateCachedStep(index, status, error, output);
    await systemQuery(this.env, "provisioning_sessions?id=eq." + sessionId, {
      method: "PATCH",
      body: JSON.stringify({ steps: this.cachedSteps, current_step: index }),
    });
  }

  /** Consolidates the step-success write path — provisioning_sessions PATCH +
   *  StepCompleted event insert + success log insert — into a single
   *  Postgres RPC call (migration 073_step_complete_rpc.sql) instead of 3
   *  separate REST round trips. Cuts 2 Cloudflare subrequests per step; this
   *  DO invocation's whole deploy shares one subrequest budget with Workers
   *  Free plan's 50-per-invocation ceiling, and bookkeeping alone was
   *  measured eating most of it (2026-08-02 incident). Falls back to logging
   *  (never throws) on failure, same as the durable emit it replaces — a
   *  lost StepCompleted here is recoverable via the watchdog alarm reconciling
   *  from provisioning_sessions.steps, which this call already wrote. */
  private async stepCompleteRpc(
    sessionId: string,
    stackId: string,
    index: number,
    status: string,
    output: Record<string, string> | undefined,
    eventPayload: Record<string, unknown>,
    idempotencyKeySuffix: string,
    logService: string,
    logMessage: string,
  ): Promise<void> {
    this.mutateCachedStep(index, status, undefined, output);

    const seqKey = `seq:${sessionId}`;
    if (!this._seqCounters.has(seqKey)) {
      const stored = await this.state.storage
        .get<number>(seqKey)
        .catch(() => undefined);
      if (stored) this._seqCounters.set(seqKey, stored);
    }
    const seq = (this._seqCounters.get(seqKey) ?? 0) + 1;
    this._seqCounters.set(seqKey, seq);
    await this.state.storage.put(seqKey, seq);

    const body = {
      p_session_id: sessionId,
      p_stack_id: stackId,
      p_steps: this.cachedSteps,
      p_current_step: index,
      p_sequence: seq,
      p_event_type: "StepCompleted",
      p_event_payload: redactPayload(eventPayload),
      p_idempotency_key: `${sessionId}:StepCompleted:${idempotencyKeySuffix}`,
      p_log_level: "info",
      p_log_service: logService,
      p_log_message: redactSecretsFromText(logMessage, [...this.secretValues]),
      p_log_metadata: {},
    };

    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await systemQuery(this.env, "rpc/step_complete", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (res.ok) return;
        if (attempt === MAX_ATTEMPTS) {
          createLogger({ session: sessionId, stack: stackId }).error(
            "provision.step_complete_rpc_failed",
            { status: res.status },
          );
          return;
        }
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          createLogger({ session: sessionId, stack: stackId }).error(
            "provision.step_complete_rpc_failed",
            { error: err instanceof Error ? err.message : String(err) },
          );
          return;
        }
      }
      await scheduler.wait(300 * attempt);
    }
  }

  private async updateStatus(stackId: string, status: string) {
    const MAX_ATTEMPTS = 3;
    let lastErr: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await systemQuery(this.env, "stacks?id=eq." + stackId, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        });
        if (res.ok) return;
        lastErr = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    // Never throw — see updateSession for why (called from the caller's own catch).
    createLogger({ stack: stackId }).error(
      "provision.updateStatus_persist_failed",
      { status, error: lastErr },
    );
  }

  /** Authoritatively reconcile the workflow card's status (projects.status).
   *  The frontend also writes this from useDeployFlow, but only while a tab is
   *  watching the session transition — so a deploy that finishes with no open
   *  tab would otherwise leave a stale 'error'. Mirrors updateStatus: retry 3×,
   *  NEVER throw (called from finalization, inside/after the top-level catch). */
  private async updateProjectStatus(
    projectId: string,
    status: "active" | "error" | "draft",
  ) {
    const MAX_ATTEMPTS = 3;
    let lastErr: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await systemQuery(this.env, "projects?id=eq." + projectId, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status }),
        });
        if (res.ok) return;
        lastErr = `HTTP ${res.status}: ${await res.text().catch(() => "")}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    // Never throw — see updateSession for why (called from finalization paths).
    createLogger({ project: projectId }).error(
      "provision.updateProjectStatus_persist_failed",
      { status, error: lastErr },
    );
  }

  /** Fire-and-forget — email failure must never affect the provision outcome. */
  private async sendDeployEmail(
    userId: string,
    kind: "success" | "failure",
    opts: {
      projectName: string;
      services?: string[];
      deployUrl?: string;
      workflowId?: string | null;
      errorMessage?: string;
      failedService?: string;
      durationMs?: number;
    },
  ): Promise<void> {
    try {
      // Resolve user email from Supabase Auth admin API
      const authRes = await fetch(
        `${this.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`,
        {
          headers: {
            apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${this.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      if (!authRes.ok) return;
      const user = await authRes.json<{ email?: string }>();
      if (!user.email) return;

      const workflowUrl = opts.workflowId
        ? `${this.env.FRONTEND_URL}/workspace/${opts.workflowId}`
        : this.env.FRONTEND_URL;

      const { subject, html, text } =
        kind === "success"
          ? deploySuccessEmail({
              projectName: opts.projectName,
              services: opts.services ?? [],
              deployUrl: opts.deployUrl,
              workflowUrl,
              durationMs: opts.durationMs,
            })
          : deployFailureEmail({
              projectName: opts.projectName,
              errorMessage: opts.errorMessage ?? "Unknown error",
              workflowUrl,
              failedService: opts.failedService,
            });

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: this.env.RESEND_FROM,
          to: [user.email],
          subject,
          html,
          text,
        }),
      });
    } catch {
      /* email failure is non-fatal */
    }
  }

  /** Race a best-effort promise against a timeout so a hung external call can
   *  never stall deploy finalization. Rejects with a labelled error on timeout
   *  (caller is expected to .catch and continue). The timer is always cleared,
   *  so a fast-resolving promise doesn't keep the isolate alive. */
  /**
   * Deployment attribution stamped into users' deployed repos (marker commit +
   * GitHub Deployment record). Pulls name/url/email from env with generic,
   * FRONTEND_URL-derived fallbacks so self-host installs carry no vendor brand.
   */
  private deployBrand(): { name: string; url: string; email: string } {
    const url = this.env.DEPLOY_BRAND_URL || this.env.FRONTEND_URL;
    let host = "localhost";
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep default */
    }
    return {
      name: this.env.DEPLOY_BRAND_NAME || "Deployment",
      url,
      email: this.env.DEPLOY_COMMIT_EMAIL || `deploy@${host}`,
    };
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  private async writeMap(
    stackId: string,
    stack: ApprovedStack,
    ctx: Record<string, string>,
  ) {
    const ID_KEYS: Record<string, string> = {
      vercel: "vercel_project_id",
      supabase: "supabase_project_ref",
      github: "github_repo_name",
      "cloudflare-workers": "cloudflare_worker_name",
      "cloudflare-r2": "r2_bucket_name",
    };
    const URL_KEYS: Record<string, string> = {
      vercel: "vercel_project_url",
      supabase: "supabase_url",
      github: "github_repo_url",
      "cloudflare-workers": "cloudflare_worker_url",
      "cloudflare-r2": "r2_endpoint",
    };

    const services = stack.steps.map((step) => ({
      stack_id: stackId,
      service_type: step.service,
      external_id: ctx[ID_KEYS[step.service] ?? ""] ?? null,
      display_url: ctx[URL_KEYS[step.service] ?? ""] ?? null,
      status: "ready",
      provisioned_at: new Date().toISOString(),
    }));
    const mapRes = await systemQuery(this.env, "stack_services", {
      method: "POST",
      body: JSON.stringify(services),
    });
    if (!mapRes.ok)
      throw new Error(`stack_services write failed: ${mapRes.status}`);
  }
}

// ── Framework detection from a GitHub repo (config files + package.json) ─────
async function detectRepoFramework(
  ghToken: string,
  repoName: string,
  rootDirectory?: string,
): Promise<{ framework?: Framework; hasWrangler: boolean }> {
  const GH_API = "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${ghToken}`,
    "User-Agent": "Leenar/1.0",
    Accept: "application/vnd.github.v3+json",
  };
  const listDir = async (path: string): Promise<string[]> => {
    try {
      const res = await fetch(
        `${GH_API}/repos/${repoName}/contents/${path}`,
        { headers, signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return [];
      const items = (await res.json()) as Array<{ name: string; type: string }>;
      return Array.isArray(items)
        ? items.filter((f) => f.type === "file").map((f) => f.name)
        : [];
    } catch {
      return [];
    }
  };
  const readPkg = async (path: string): Promise<unknown> => {
    try {
      const res = await fetch(`${GH_API}/repos/${repoName}/contents/${path}`, {
        headers: { ...headers, Accept: "application/vnd.github.raw+json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return undefined;
      return JSON.parse(await res.text());
    } catch {
      return undefined;
    }
  };

  const subPrefix =
    rootDirectory && rootDirectory !== "." ? `${rootDirectory.replace(/\/+$/, "")}/` : "";
  const rootFiles = await listDir("");
  const subdirFiles = subPrefix ? await listDir(subPrefix.replace(/\/$/, "")) : undefined;
  const packageJson =
    (subPrefix ? await readPkg(`${subPrefix}package.json`) : undefined) ??
    (await readPkg("package.json"));

  return {
    framework: detectFramework({ rootFiles, subdirFiles, packageJson }),
    hasWrangler: hasWranglerConfig([...rootFiles, ...(subdirFiles ?? [])]),
  };
}

// ── Env node state extraction ────────────────────────────────
function extractEnvNodeState(
  service: string,
  output: Record<string, string>,
): Record<string, string> {
  const state: Record<string, string> = {};
  if (service === "vercel" && output["vercel_project_id"]) {
    state.vercelProjectId = output["vercel_project_id"];
    if (output["vercel_project_url"])
      state.provisionedUrl = output["vercel_project_url"];
    // Persist detected framework so drift + reprovision resolve the right prefix.
    if (output["framework"]) state.framework = output["framework"];
    if (output["has_wrangler"]) state.hasWrangler = output["has_wrangler"];
  } else if (service === "supabase" && output["supabase_project_ref"]) {
    state.supabaseProjectRef = output["supabase_project_ref"];
    if (output["supabase_url"]) state.provisionedUrl = output["supabase_url"];
  } else if (service === "github" && output["github_repo_name"]) {
    state.githubRepoName = output["github_repo_name"];
    if (output["github_repo_url"])
      state.provisionedUrl = output["github_repo_url"];
  } else if (
    service === "cloudflare-workers" &&
    output["cloudflare_worker_name"]
  ) {
    state.cfWorkerNameProvisioned = output["cloudflare_worker_name"];
    if (output["cloudflare_worker_url"]) {
      state.cloudflareWorkerUrl = output["cloudflare_worker_url"];
      state.provisionedUrl = output["cloudflare_worker_url"];
    }
    if (output["cloudflare_account_id"])
      state.cloudflareAccountId = output["cloudflare_account_id"];
  } else if (service === "cloudflare-r2" && output["r2_bucket_name"]) {
    state.cfBucketNameProvisioned = output["r2_bucket_name"];
    if (output["r2_endpoint"]) {
      state.r2Endpoint = output["r2_endpoint"];
      state.provisionedUrl = output["r2_endpoint"];
    }
    if (output["cloudflare_account_id"])
      state.cloudflareAccountId = output["cloudflare_account_id"];
  }
  // Native-branching refs — service-agnostic, set only on branch deploys.
  // These are the EXACT refs teardown/promote targets (never name patterns).
  if (output["branch_mode"]) state.branchMode = output["branch_mode"];
  if (output["branch_key"]) state.branchKey = output["branch_key"];
  if (output["github_branch"]) state.githubBranch = output["github_branch"];
  if (output["vercel_branch_alias"])
    state.vercelBranchAlias = output["vercel_branch_alias"];
  if (output["supabase_clone_ref"])
    state.supabaseCloneRef = output["supabase_clone_ref"];
  return state;
}

// ── Types ───────────────────────────────────────────────────

interface StepLoopState {
  sessionId: string;
  stackId: string;
  userId: string;
  projectId: string | null;
  environmentId: string | null;
  stack: ApprovedStack;
  ctx: Record<string, string>;
  providerRefs: Record<
    string,
    {
      service: string;
      projectId?: string;
      deploymentId?: string;
      workerName?: string;
      versionId?: string;
      runId?: string;
      runUrl?: string;
    }
  >;
  canvasSnapshot: unknown;
  desiredEnvKeysMap: Record<string, string[]>;
  completedStepIndices: number[];
  completedOutputByIndex: Array<[number, Record<string, unknown>]>;
  useEvents: boolean;
  nextStepIndex: number;
  sessionStartedAt: number;
  deployStartedAt: number;
  branchCtx: {
    branchKey: string;
    trunkState: Record<string, import("./envHelpers").EnvNodeState>;
  } | null;
}

// Narrower than StepLoopState — only the fields finalizeFailure actually
// reads. A full StepLoopState structurally satisfies this, so alarm()'s
// resumed-invocation call site can pass `loop` directly. Exists because an
// error can legitimately occur BEFORE any StepLoopState is ever built (e.g.
// assertVercelGitHubLinked's preflight check, part of one-time setup that
// runs before the step loop) — finalizeFailure must still work then.
interface FinalizeFailureIds {
  sessionId: string;
  stackId: string;
  userId: string;
  projectId: string | null;
  stack: ApprovedStack;
  sessionStartedAt: number;
}

interface WatchdogState {
  sessionId: string;
  stackId: string;
  workflowId?: string;
  userId?: string;
}

interface ApprovedStack {
  projectName: string;
  steps: ProvisionStep[];
  preloadedCtx?: Record<string, string>; // env vars from already-provisioned services
}

interface ProvisionStep {
  service: string;
  action: string;
  params: Record<string, unknown>;
  nodeId?: string;
  nodeLabel?: string;
  injectEnvVars?: string[]; // env var names this step should receive from ctx
}

interface ProvisionStepRecord {
  name: string;
  nodeId?: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  error?: string;
  output?: Record<string, string>;
}
