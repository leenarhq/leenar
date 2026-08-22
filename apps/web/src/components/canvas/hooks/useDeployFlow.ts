import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Node, Edge, Viewport } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { toast } from "sonner";
import {
  provisionWorkflow,
  getProvisionSession,
  getActiveDeploymentSession,
  getConnectedServices,
  checkVercelGitHub,
  cancelDeployment,
  diagnoseProvisionError,
} from "../../../lib/api";
import type { VercelGitHubReason } from "../../../lib/api";
import {
  createProject,
  saveCanvas as saveWorkflowCanvas,
  updateProjectStatus,
  subscribeToProvisioningSession,
} from "../../../lib/workflows";
import type {
  ProvisioningStep,
  ProvisioningSession,
} from "../../../lib/workflows";
import type { LogEntry } from "../../../lib/types";
import type { SuccessService } from "../DeploySuccessModal";
import { track } from "../../../lib/monitoring";
import { nowTime, stepsToNewLogs } from "../workspaceHelpers";
import { backupKeyFor } from "./useWorkflowPersistence";
import { createSessionWatcher } from "../../../lib/sessionWatcher";

type IntegrationBanner =
  | { type: "missing"; services: string[] }
  | {
      type: "vercel_github";
      reason: VercelGitHubReason;
      vercelHasGitHub: boolean;
      githubHasVercel: boolean;
    }
  | null;

interface UseDeployFlowOptions {
  session: Session | null;
  workflowIdRef: MutableRefObject<string>;
  workflowNameRef: MutableRefObject<string>;
  setSaveState: (s: "saved" | "saving" | "unsaved") => void;
  toObject: () => { nodes: Node[]; edges: Edge[]; viewport: Viewport };
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  navigate: (opts: {
    to: string;
    params?: Record<string, string>;
    replace?: boolean;
  }) => void;
  setIsTerminalOpen: (open: boolean) => void;
  currentEnvId?: string | null;
  onDeploySuccess?: () => void;
}

/** Owns the entire deploy lifecycle: pre-flight integration checks,
 *  provisioning kickoff, realtime subscription, log generation,
 *  step → node status mirror, success modal + edge sync animation. */
export function useDeployFlow({
  session,
  workflowIdRef,
  workflowNameRef,
  setSaveState,
  toObject,
  nodes,
  setNodes,
  setEdges,
  navigate,
  setIsTerminalOpen,
  currentEnvId,
  onDeploySuccess,
}: UseDeployFlowOptions) {
  const [isRunning, setIsRunning] = useState(false);
  const [deployLogs, setDeployLogs] = useState<LogEntry[]>([]);
  const [deployStepCount, setDeployStepCount] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [deployError, setDeployError] = useState(false);
  const [deployErrorMsg, setDeployErrorMsg] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiSuggestionLoading, setAiSuggestionLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successServices, setSuccessServices] = useState<SuccessService[]>([]);
  const [completedStackId, setCompletedStackId] = useState<string | null>(null);
  const [integrationBanner, setIntegrationBanner] =
    useState<IntegrationBanner>(null);

  const currentStackIdRef = useRef<string | null>(null);
  const unsubProvisionRef = useRef<(() => void) | null>(null);
  const prevStepsRef = useRef<ProvisioningStep[]>([]);
  // Set to true after deploy success so the post-render effect explicitly saves the canvas
  const pendingSaveSessionRef = useRef(false);
  // Guards the recovery effect — prevents re-running on Supabase token refresh, which
  // creates a new session object every ~60 min and would otherwise re-trigger polling.
  const recoveryRanRef = useRef(false);
  // Synchronous guard — set before the first await in handleDeployToggle so a
  // rapid second click (or /deploy) can't kick off a duplicate provision before
  // React commits setIsRunning(true).
  const deployInFlightRef = useRef(false);

  // Stable ref to latest nodes — avoids stale closure in handleSession
  const nodesRef = useRef<Node[]>(nodes);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // Unsubscribe from polling on unmount
  useEffect(() => {
    return () => {
      unsubProvisionRef.current?.();
    };
  }, []);

  // After deploy success, clear any localStorage backup immediately so the next
  // page load doesn't show "unsaved local changes". The versioned auto-save
  // debounce (1.5 s) handles the actual server write; if the DO's canvas patches
  // caused a version drift the silent-retry in useWorkflowPersistence resolves it
  // without showing a toast. We intentionally avoid calling saveWorkflowCanvas
  // (no-version) here because it races with the auto-save and creates extra drifts.
  useEffect(() => {
    if (isRunning) return;
    if (!pendingSaveSessionRef.current) return;
    pendingSaveSessionRef.current = false;
    if (!workflowIdRef.current || workflowIdRef.current === "new") return;
    localStorage.removeItem(backupKeyFor(workflowIdRef.current, currentEnvId));
  }, [isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Core session handler ────────────────────────────────────────────────────
  // Extracted to hook scope so both handleDeployToggle and the recovery effect
  // can share the same implementation.

  const handleSession = useCallback(
    (ps: ProvisioningSession, currentSession: Session) => {
      const newLogs = stepsToNewLogs(prevStepsRef.current, ps.steps);
      if (newLogs.length > 0) setDeployLogs((prev) => [...prev, ...newLogs]);
      prevStepsRef.current = ps.steps;

      // Update step counter: completed = success + error, total from session
      if (ps.steps.length > 0) {
        const completed = ps.steps.filter(
          (s) => s.status === "success" || s.status === "error",
        ).length;
        const total = ps.total_steps > 0 ? ps.total_steps : ps.steps.length;
        setDeployStepCount({ completed, total });
      }

      // Mirror individual step states onto nodes (provisioning / error / provisioned).
      // These are runtime-only fields; authoringKey ignores them, so writing them
      // into node.data updates the display without triggering an auto-save.
      setNodes((nds: Node[]) =>
        nds.map((n) => {
          const step = ps.steps.find((s) => s.nodeId === n.id);
          if (!step) return n;
          if (step.status === "running")
            return { ...n, data: { ...n.data, status: "provisioning" } };
          if (step.status === "error")
            return {
              ...n,
              data: { ...n.data, status: "error", errorMsg: step.error },
            };
          if (step.status === "success" && step.output) {
            // Node completed successfully even if overall session failed/cancelled
            const out = step.output as Record<string, string>;
            const url = Object.values(out).find(
              (v) => typeof v === "string" && v.startsWith("http"),
            );
            return {
              ...n,
              data: {
                ...n.data,
                status: "provisioned",
                provisionedAt: n.data.provisionedAt ?? new Date().toISOString(),
                stackId: currentStackIdRef.current ?? n.data.stackId,
                ...(url ? { provisionedUrl: url } : {}),
                ...(out.vercel_project_id
                  ? { vercelProjectId: out.vercel_project_id }
                  : {}),
                ...(out.supabase_project_ref
                  ? { supabaseProjectRef: out.supabase_project_ref }
                  : {}),
                ...(out.github_repo_name
                  ? { githubRepoName: out.github_repo_name }
                  : {}),
                ...(out.cloudflare_worker_name
                  ? { cfWorkerNameProvisioned: out.cloudflare_worker_name }
                  : {}),
                ...(out.cloudflare_worker_url
                  ? { cloudflareWorkerUrl: out.cloudflare_worker_url }
                  : {}),
                ...(out.r2_bucket_name
                  ? { cfBucketNameProvisioned: out.r2_bucket_name }
                  : {}),
                ...(out.r2_endpoint ? { r2Endpoint: out.r2_endpoint } : {}),
                ...(out.cloudflare_account_id
                  ? { cloudflareAccountId: out.cloudflare_account_id }
                  : {}),
              },
            };
          }
          return n;
        }),
      );

      if (ps.status === "success") {
        // Stop polling immediately — prevents a concurrent interval tick from
        // calling handleSession again while this branch is still executing.
        unsubProvisionRef.current?.();
        unsubProvisionRef.current = null;
        const succeededStackId = currentStackIdRef.current;
        currentStackIdRef.current = null;
        track("deploy_succeeded", {
          stack_id: succeededStackId,
          step_count: ps.steps.length,
        });
        setIsRunning(false);
        onDeploySuccess?.();
        setDeployError(false);
        setDeployErrorMsg(null);
        // Collect service URLs for the success modal
        const svcs: SuccessService[] = ps.steps
          .filter((s) => s.output)
          .map((s) => {
            const out = s.output as Record<string, string>;
            const url = Object.values(out).find(
              (v) => typeof v === "string" && v.startsWith("http"),
            );
            return url
              ? { name: s.name, url, deploymentId: out.vercel_deployment_id }
              : null;
          })
          .filter(Boolean) as SuccessService[];
        setSuccessServices(svcs);
        setShowSuccessModal(true);
        if (succeededStackId) setCompletedStackId(succeededStackId);
        setDeployLogs((prev) => [
          ...prev,
          {
            time: nowTime(),
            source: "system",
            msg: "All services provisioned successfully!",
            type: "success" as const,
          },
        ]);
        // An edge is synced when BOTH endpoints are provisioned —
        // either just now (in ps.steps) or already from a previous session.
        // GitHub and Resend are config-only (never provisioned) so we treat them
        // as "always ready" — edge syncs when the other endpoint is provisioned.
        const CONFIG_ONLY_PROVIDERS = new Set(["github", "resend"]);
        setNodes((nds: Node[]) =>
          nds.map((n) => {
            const provider = (n.data as Record<string, unknown>)?.provider as
              | string
              | undefined;
            // Config-only nodes have no provision step — mark them provisioned
            // automatically so the canvas reflects the deployment outcome.
            if (CONFIG_ONLY_PROVIDERS.has(provider ?? "")) {
              if ((n.data as Record<string, unknown>)?.status === "provisioned")
                return n;
              return {
                ...n,
                data: {
                  ...n.data,
                  status: "provisioned",
                  provisionedAt: new Date().toISOString(),
                },
              };
            }
            const step = ps.steps.find((s) => s.nodeId === n.id);
            if (!step?.output) return n;
            const out = step.output as Record<string, string>;
            const url = Object.values(out).find(
              (v) => typeof v === "string" && v.startsWith("http"),
            );
            return {
              ...n,
              data: {
                ...n.data,
                status: "provisioned",
                provisionedAt: new Date().toISOString(),
                stackId: succeededStackId,
                ...(url ? { provisionedUrl: url } : {}),
                ...(out.vercel_project_id
                  ? { vercelProjectId: out.vercel_project_id }
                  : {}),
                ...(out.supabase_project_ref
                  ? { supabaseProjectRef: out.supabase_project_ref }
                  : {}),
                ...(out.github_repo_name
                  ? { githubRepoName: out.github_repo_name }
                  : {}),
                ...(out.cloudflare_worker_name
                  ? { cfWorkerNameProvisioned: out.cloudflare_worker_name }
                  : {}),
                ...(out.cloudflare_worker_url
                  ? { cloudflareWorkerUrl: out.cloudflare_worker_url }
                  : {}),
                ...(out.r2_bucket_name
                  ? { cfBucketNameProvisioned: out.r2_bucket_name }
                  : {}),
                ...(out.r2_endpoint ? { r2Endpoint: out.r2_endpoint } : {}),
                ...(out.cloudflare_account_id
                  ? { cloudflareAccountId: out.cloudflare_account_id }
                  : {}),
              },
            };
          }),
        );
        const CONFIG_EDGE_PAIRS = new Set(["github→vercel", "resend→supabase"]);
        const justSucceededIds = new Set(
          ps.steps
            .filter((s) => s.status === "success" && s.nodeId)
            .map((s) => s.nodeId!),
        );
        const currentNodes = nodesRef.current;
        const alreadyProvisionedIds = new Set(
          currentNodes
            .filter(
              (n) =>
                (n.data as Record<string, unknown>)?.status === "provisioned",
            )
            .map((n) => n.id),
        );
        const allProvisionedIds = new Set([
          ...justSucceededIds,
          ...alreadyProvisionedIds,
        ]);
        const nodeProviderMap = new Map(
          currentNodes.map((n) => [
            n.id,
            (n.data as Record<string, unknown>)?.provider as string | undefined,
          ]),
        );
        const isReady = (nodeId: string) =>
          allProvisionedIds.has(nodeId) ||
          CONFIG_ONLY_PROVIDERS.has(nodeProviderMap.get(nodeId) ?? "");

        setEdges((eds: Edge[]) =>
          eds.map((e) => {
            if ((e.data as Record<string, unknown>)?.synced) return e;
            const hasEnv = !!(e.data as { envVars?: string[] })?.envVars
              ?.length;
            const edgeKey = `${nodeProviderMap.get(e.source) ?? ""}→${nodeProviderMap.get(e.target) ?? ""}`;
            if (!hasEnv && !CONFIG_EDGE_PAIRS.has(edgeKey)) return e;
            if (isReady(e.source) && isReady(e.target)) {
              return {
                ...e,
                data: {
                  ...(e.data as Record<string, unknown>),
                  synced: true,
                },
                // `data.synced` above is what turns the line and the
                // arrowhead ok; no colour is stored — see BlueprintEdge.
                markerEnd: { type: MarkerType.ArrowClosed },
              };
            }
            return e;
          }),
        );
        if (workflowIdRef.current) {
          updateProjectStatus(workflowIdRef.current, "active").catch(() => {});
        }
        if (
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("Deployment complete", {
            body: `${workflowNameRef.current || "Your workflow"} is live.`,
            icon: "/favicon.ico",
          });
        }
        // Signal post-render effect to explicitly save provisioned IDs to DB
        if (workflowIdRef.current && workflowIdRef.current !== "new") {
          pendingSaveSessionRef.current = true;
        }
      } else if (ps.status === "failed" || ps.status === "cancelled") {
        unsubProvisionRef.current?.();
        unsubProvisionRef.current = null;
        const failedStackId = currentStackIdRef.current;
        currentStackIdRef.current = null;
        // Reset any nodes still stuck in "provisioning" back to idle (runtime-only)
        setNodes((nds: Node[]) =>
          nds.map((n) => {
            if (n.data?.status === "provisioning")
              return { ...n, data: { ...n.data, status: undefined } };
            return n;
          }),
        );
        setIsRunning(false);
        if (ps.status === "failed") {
          // Persist the failed state so the workflow card reflects reality. Mirrors
          // the "active"-on-success write above; without this projects.status stays
          // draft/active while the stack errored (UI ↔ stacks desync).
          if (workflowIdRef.current && workflowIdRef.current !== "new") {
            updateProjectStatus(workflowIdRef.current, "error").catch(() => {});
          }
          track("deploy_failed", {
            stack_id: failedStackId,
            error: ps.error_message,
          });
          setDeployError(true);
          setDeployErrorMsg(ps.error_message ?? null);
          if (failedStackId) setCompletedStackId(failedStackId);
          // Fire AI diagnosis in background
          if (ps.error_message) {
            const serviceNames = (ps.steps ?? [])
              .map((s: ProvisioningStep) => s.name)
              .filter(Boolean);
            setAiSuggestionLoading(true);
            diagnoseProvisionError(
              ps.error_message,
              serviceNames,
              workflowNameRef.current || "Leenar Project",
              currentSession,
            )
              .then((s) => setAiSuggestion(s))
              .catch(() => {})
              .finally(() => setAiSuggestionLoading(false));
          }
        }
        setDeployLogs((prev) => [
          ...prev,
          {
            time: nowTime(),
            source: "system",
            msg: `Provisioning ${ps.status}${ps.error_message ? ": " + ps.error_message : ""}`,
            type: "error" as const,
          },
        ]);
      }
    },
    [
      // All state setters and refs are stable — this callback never changes
      setDeployLogs,
      setDeployStepCount,
      setNodes,
      setEdges,
      setIsRunning,
      setDeployError,
      setDeployErrorMsg,
      setSuccessServices,
      setShowSuccessModal,
      setCompletedStackId,
      setAiSuggestion,
      setAiSuggestionLoading,
      workflowIdRef,
      workflowNameRef,
      currentStackIdRef,
      unsubProvisionRef,
      prevStepsRef,
      onDeploySuccess,
    ],
  );

  // ── Realtime session helper ─────────────────────────────────────────────────
  // Subscribes to provisioning_sessions via Supabase Realtime (instant updates)
  // with a 15-second polling fallback in case the WebSocket connection drops.

  const startSessionPolling = useCallback(
    (sessionId: string, stackId: string, currentSession: Session) => {
      currentStackIdRef.current = stackId;

      const stop = createSessionWatcher({
        fetchSession: async () => {
          const raw = await getProvisionSession(
            workflowIdRef.current,
            sessionId,
            currentSession,
          );
          return raw as unknown as ProvisioningSession;
        },
        subscribe: (onChange, onStatus) =>
          subscribeToProvisioningSession(sessionId, onChange, onStatus),
        onUpdate: (ps) => handleSession(ps, currentSession),
      });

      unsubProvisionRef.current?.();
      unsubProvisionRef.current = stop;
    },
    [handleSession, workflowIdRef, currentStackIdRef, unsubProvisionRef],
  );

  // ── Recovery effect ─────────────────────────────────────────────────────────
  // On mount (once session is available), check if a deployment was already
  // running before the page loaded. If so, reconnect the polling loop and
  // reopen the terminal so the user doesn't lose visibility.

  useEffect(() => {
    if (recoveryRanRef.current || !session || workflowIdRef.current === "new")
      return;
    recoveryRanRef.current = true;

    getActiveDeploymentSession(workflowIdRef.current, session)
      .then((active) => {
        if (!active) return;
        prevStepsRef.current = [];
        setDeployError(false);
        setDeployErrorMsg(null);
        setDeployStepCount(null);
        setIsRunning(true);
        setIsTerminalOpen(true);
        setDeployLogs((prev) => [
          ...prev,
          {
            time: nowTime(),
            source: "system",
            msg: "Reconnected to running deployment…",
            type: "info" as const,
          },
        ]);
        startSessionPolling(active.sessionId, active.stackId, session);
      })
      .catch(() => {
        /* ignore — no active session or network error */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]); // recoveryRanRef guards against re-runs on Supabase token refresh

  // ── Main deploy toggle ──────────────────────────────────────────────────────

  const handleDeployToggle = useCallback(async () => {
    if (isRunning) {
      unsubProvisionRef.current?.();
      const stackId = currentStackIdRef.current;
      setIsRunning(false);
      currentStackIdRef.current = null;
      setDeployLogs((prev) => [
        ...prev,
        {
          time: nowTime(),
          source: "system",
          msg: "Provisioning cancelled.",
          type: "warning" as const,
        },
      ]);
      if (stackId && session)
        cancelDeployment(stackId, session).catch(() => {});
      return;
    }

    if (!session) {
      setDeployLogs([
        {
          time: nowTime(),
          source: "system",
          msg: "Not authenticated. Please log in again.",
          type: "error" as const,
        },
      ]);
      setIsTerminalOpen(true);
      return;
    }

    if (deployInFlightRef.current) return;
    deployInFlightRef.current = true;

    try {
      const canvas = toObject();

      // Pre-flight: check all required integrations are connected
      const neededServices = [
        ...new Set(
          (canvas.nodes as Node[])
            .filter(
              (n) =>
                n.type === "service" &&
                (n.data as Record<string, unknown>)?.status !== "provisioned",
            )
            .map((n) => (n.data as Record<string, unknown>)?.provider as string)
            .filter(Boolean),
        ),
      ];

      if (neededServices.length > 0) {
        const connected = await getConnectedServices(session);
        const missing = neededServices.filter(
          (svc) => !connected.includes(svc),
        );

        if (missing.length > 0) {
          setIntegrationBanner({ type: "missing", services: missing });
          deployInFlightRef.current = false;
          return;
        }

        // If Vercel is in the stack, check Vercel↔GitHub two-way link
        const hasVercelNode = (canvas.nodes as Node[]).some(
          (n) =>
            n.type === "service" &&
            (n.data as Record<string, unknown>)?.provider === "vercel",
        );
        if (hasVercelNode) {
          try {
            const vgh = await checkVercelGitHub(session);
            if (!vgh.linked) {
              setIntegrationBanner({
                type: "vercel_github",
                reason: vgh.reason ?? "not_linked",
                vercelHasGitHub: vgh.vercelHasGitHub,
                githubHasVercel: vgh.githubHasVercel,
              });
              deployInFlightRef.current = false;
              return;
            }
          } catch {
            // The preflight itself failed — we know nothing about the link, so
            // don't claim it's missing.
            setIntegrationBanner({
              type: "vercel_github",
              reason: "check_failed",
              vercelHasGitHub: false,
              githubHasVercel: false,
            });
            deployInFlightRef.current = false;
            return;
          }
        }
      }

      if (workflowIdRef.current === "new") {
        setSaveState("saving");
        const wf = await createProject(workflowNameRef.current);
        workflowIdRef.current = wf.id;
        navigate({
          to: "/console/projects/$id/canvas",
          params: { id: wf.id },
          replace: true,
        });
        await saveWorkflowCanvas(wf.id, toObject());
        setSaveState("saved");
      }

      setIsRunning(true);
      setIsTerminalOpen(true);
      setDeployError(false);
      setDeployErrorMsg(null);
      setDeployStepCount(null);
      prevStepsRef.current = [];
      setDeployLogs([
        {
          time: nowTime(),
          source: "system",
          msg: "Starting provisioning…",
          type: "info" as const,
        },
        {
          time: nowTime(),
          source: "system",
          msg: "Limit: 5 deployments per 10 minutes.",
          type: "info" as const,
        },
      ]);
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default"
      ) {
        Notification.requestPermission().catch(() => {});
      }

      track("deploy_started", {
        workflow_id: workflowIdRef.current,
        node_count: canvas.nodes.length,
        providers: [
          ...new Set(
            (canvas.nodes as Node[])
              .map((n) => (n.data as Record<string, unknown>)?.provider)
              .filter(Boolean),
          ),
        ],
      });

      const { sessionId, stackId } = await provisionWorkflow(
        workflowIdRef.current,
        canvas,
        session,
        workflowNameRef.current,
        currentEnvId,
      );

      startSessionPolling(sessionId, stackId, session);
      deployInFlightRef.current = false;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setIsRunning(false);
      setIsTerminalOpen(true);
      setDeployLogs([
        {
          time: nowTime(),
          source: "system",
          msg: `Error: ${msg}`,
          type: "error" as const,
        },
      ]);
      deployInFlightRef.current = false;
    }
  }, [
    isRunning,
    session,
    toObject,
    navigate,
    setNodes,
    setEdges,
    nodes,
    setIsTerminalOpen,
    setSaveState,
    workflowIdRef,
    workflowNameRef,
    startSessionPolling,
    currentEnvId,
  ]);

  const handleNodeRedeploy = useCallback(
    async (nodeId: string) => {
      if (!session || !workflowIdRef.current) return;
      const canvas = toObject();
      try {
        const { sessionId, stackId } = await provisionWorkflow(
          workflowIdRef.current,
          canvas,
          session,
          workflowNameRef.current,
          currentEnvId,
          { nodeIds: [nodeId] },
        );
        startSessionPolling(sessionId, stackId, session);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg || "Failed to start redeploy.");
      }
    },
    [
      session,
      currentEnvId,
      startSessionPolling,
      workflowNameRef,
      workflowIdRef,
      toObject,
    ],
  );

  const resetDeployState = useCallback(() => {
    unsubProvisionRef.current?.();
    unsubProvisionRef.current = null;
    currentStackIdRef.current = null;
    prevStepsRef.current = [];
    setIsRunning(false);
    setDeployLogs([]);
    setDeployStepCount({ completed: 0, total: 0 });
    setDeployError(false);
    setDeployErrorMsg(null);
    setAiSuggestion(null);
    setAiSuggestionLoading(false);
    setIntegrationBanner(null);
    setShowSuccessModal(false);
    setSuccessServices([]);
    setCompletedStackId(null);
  }, [
    setIsRunning,
    setDeployLogs,
    setDeployStepCount,
    setDeployError,
    setDeployErrorMsg,
    setAiSuggestion,
    setAiSuggestionLoading,
    setIntegrationBanner,
    setShowSuccessModal,
    setSuccessServices,
    setCompletedStackId,
  ]);

  return {
    isRunning,
    deployLogs,
    setDeployLogs,
    deployStepCount,
    deployError,
    deployErrorMsg,
    aiSuggestion,
    aiSuggestionLoading,
    showSuccessModal,
    setShowSuccessModal,
    successServices,
    completedStackId,
    integrationBanner,
    setIntegrationBanner,
    handleDeployToggle,
    handleNodeRedeploy,
    resetDeployState,
  };
}
