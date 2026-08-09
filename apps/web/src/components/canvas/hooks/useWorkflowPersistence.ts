import React, { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Node, Edge, Viewport, FitViewOptions } from "@xyflow/react";
import { toast } from "sonner";
import {
  getProject,
  createProject,
  saveCanvas as saveWorkflowCanvas,
  type ProjectStatus,
} from "../../../lib/workflows";
import {
  checkWorkflowResourceHealth,
  saveCanvasApi,
  saveEnvCanvas,
  getEnvCanvas,
  getLockStatus,
  CanvasConflictError,
  CanvasLockedError,
} from "../../../lib/api";
import { isTabHidden } from "../../../lib/visibility";
import { buildTemplateCanvas } from "../workspaceTemplates";

type SaveState = "saved" | "saving" | "unsaved";

interface UseWorkflowPersistenceOptions {
  workflowId: string;
  template?: string;
  session: Session | null;
  nodes: Node[];
  edges: Edge[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setViewport: (vp: Viewport) => void;
  fitView: (opts?: FitViewOptions) => void;
  toObject: () => { nodes: Node[]; edges: Edge[]; viewport: Viewport };
  navigate: (opts: {
    to: string;
    params?: Record<string, string>;
    replace?: boolean;
  }) => void;
  /** When set, saves go to the env canvas endpoint instead of the workflow canvas. */
  currentEnvId?: string | null;
}

/** JSON.stringify with object keys recursively sorted, so two structurally
 *  identical values serialize identically regardless of key order. Required
 *  because the canvas is stored as Postgres JSONB, which does NOT preserve
 *  object key order — the server round-trips nodes/edges with reordered keys. */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Runtime / derived node-data fields. These are OWNED by the backend
 *  (provisioner DO writes them to `project_env_node_state`) or by client
 *  monitoring hooks (drift / incident / usage). They are NEVER authoring intent,
 *  so they must not be persisted into the canvas JSON and must not count as a
 *  change for auto-save. Kept in sync with RESOURCE_STATE_KEYS in
 *  workers/api/src/routes/environments.ts plus the monitoring fields. */
const RUNTIME_KEYS = new Set([
  "status",
  "provisionedAt",
  "stackId",
  "errorMsg",
  "desiredEnvKeys",
  "provisionedUrl",
  "vercelProjectId",
  "supabaseProjectRef",
  "githubRepoName",
  "githubRepoUrl",
  "cfWorkerNameProvisioned",
  "cfBucketNameProvisioned",
  "cloudflareWorkerUrl",
  "cloudflareAccountId",
  "r2Endpoint",
  "driftCount",
  "incidentCount",
  "incidents",
  "usage",
  // Native-branching runtime overlay (from project_env_node_state) — never
  // authoring intent, so must not be persisted into the canvas JSON. Mirrors
  // the backend RUNTIME_NODE_KEYS additions in canvasRuntime.ts.
  "branchMode",
  "branchKey",
  "githubBranch",
  "vercelBranchAlias",
  "supabaseCloneRef",
]);

/** Returns node.data with all runtime/derived keys removed. */
function stripRuntimeData(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (!RUNTIME_KEYS.has(k)) out[k] = v;
  }
  return out;
}

/** A node stripped to what we persist: authoring data only (runtime removed).
 *  ReactFlow-ephemeral top-level fields (measured, selected, …) are stripped
 *  server-side by CanvasNodeSchema, so we leave them here. */
export function stripRuntimeNode(node: Node): Node {
  return {
    ...node,
    data: stripRuntimeData(node.data) as Record<string, unknown>,
  } as Node;
}

/** Projects a node to only the fields that define authoring intent. Strips both
 *  the ReactFlow-ephemeral top-level fields the server drops (measured, selected,
 *  dragging, width, height, positionAbsolute, …) AND runtime/derived data, so two
 *  nodes that differ only by provisioned status / drift count / usage compare
 *  equal. Used for both the auto-save change key and the backup/server compare. */
function normalizeNode(node: unknown): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as Record<string, unknown>;
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: stripRuntimeData(n.data),
  };
}

function normalizeNodes(nodes: unknown): unknown {
  return Array.isArray(nodes) ? nodes.map(normalizeNode) : nodes;
}

/** Content key for auto-save change detection: authoring nodes + edges, immune
 *  to object key order (JSONB) and to runtime/derived node-data mutations.
 *  When this key is unchanged, there is nothing new to persist. */
function authoringKey(nodes: Node[], edges: Edge[]): string {
  return (
    canonicalStringify(normalizeNodes(nodes)) + "|" + canonicalStringify(edges)
  );
}

/** Returns true when backup content is structurally identical to the server
 *  canvas, ignoring object key order (JSONB does not preserve it) and the
 *  ephemeral ReactFlow node fields the server strips on save.
 *  Both sides are plain JSON (no functions, no circular refs). */
export function backupMatchesServer(
  backup: { nodes: unknown; edges: unknown },
  serverCanvas: { nodes: unknown; edges: unknown },
): boolean {
  return (
    canonicalStringify(normalizeNodes(backup.nodes)) ===
      canonicalStringify(normalizeNodes(serverCanvas.nodes)) &&
    canonicalStringify(backup.edges) === canonicalStringify(serverCanvas.edges)
  );
}

/** localStorage key for the canvas safety-net backup. Scoped by environment so a
 *  stale backup from environment A can never restore onto environment B after an
 *  env switch. Falls back to the unscoped key when envId is absent (the "new" /
 *  no-env edge case) to preserve existing behavior there. Must be used
 *  identically in useWorkflowPersistence.ts and WorkspaceCanvas.tsx to avoid
 *  key drift between the writer (auto-save) and the reader (restore). */
export function backupKeyFor(
  workflowId: string,
  envId: string | null | undefined,
): string {
  return envId
    ? `leenar_canvas_backup_${workflowId}_${envId}`
    : `leenar_canvas_backup_${workflowId}`;
}

/** Owns: initial load (template/pending/backup/existing), debounced auto-save,
 *  health check for provisioned nodes. Exposes refs for downstream consumers
 *  (deploy flow reads workflowIdRef/workflowNameRef). */
export function useWorkflowPersistence({
  workflowId,
  template,
  session,
  nodes,
  edges,
  setNodes,
  setEdges,
  setViewport,
  fitView,
  toObject,
  navigate,
  currentEnvId,
}: UseWorkflowPersistenceOptions) {
  const currentEnvIdRef = useRef(currentEnvId);
  useEffect(() => {
    currentEnvIdRef.current = currentEnvId;
  }, [currentEnvId]);
  const [workflowName, setWorkflowName] = useState(
    workflowId === "new" ? "New Workflow" : "Workflow",
  );
  // Real project status ('draft' | 'active' | 'error') from getProject, surfaced
  // so callers can derive isLive = status === "active" instead of relying on a
  // node-provisioned proxy (which false-positives on imported-but-undeployed
  // nodes). null until the initial load resolves (or for workflowId === "new").
  const [workflowStatus, setWorkflowStatus] = useState<ProjectStatus | null>(
    null,
  );
  const workflowIdRef = useRef(workflowId);
  const workflowNameRef = useRef(
    workflowId === "new" ? "New Workflow" : "Workflow",
  );
  const canSaveRef = useRef(workflowId === "new");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const healthCheckWorkflowRef = useRef<string | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [currentWorkflowId, setCurrentWorkflowId] = useState(workflowId);

  // Canvas version for optimistic concurrency control
  const canvasVersionRef = useRef<number>(0);

  // Authoring-content key of the last state that is known to match the server
  // (last successful save, or the canvas we just loaded). Auto-save is skipped
  // while the current authoring key equals this — so runtime-only node mutations
  // (provision status, drift counts, usage) never trigger a write. null until the
  // first load/save establishes a baseline.
  const lastSavedKeyRef = useRef<string | null>(null);

  // Sets the "known saved" baseline to the given canvas so a subsequent
  // programmatic load (initial fetch, env switch, template) does not re-save
  // content that already matches the server.
  const resetBaseline = useRef((n: Node[], e: Edge[]) => {
    lastSavedKeyRef.current = authoringKey(n, e);
  }).current;

  // Mirror of lockStatus kept in a ref so the save effect can read it at fire-time
  // without being listed as a dependency (which would re-schedule saves on every poll).
  const lockStatusRef = useRef<typeof lockStatus>(null);

  // Lock state — polled every 10 s while the deploy panel is visible
  const [lockStatus, setLockStatus] = useState<{
    locked: boolean;
    lockedAt: string | null;
    lockedBy: string | null;
    ageSeconds: number;
  } | null>(null);

  // Snapshotted while React + ReactFlow are fully live.
  // Unmount flush and visibilitychange handler use this instead of calling
  // toObject() after teardown (which returns an empty store).
  const lastCanvasRef = useRef<ReturnType<typeof toObject> | null>(null);

  const [initialChatMessages, setInitialChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);

  // ── Flush helper ────────────────────────────────────────────────────────────
  // Shared by unmount cleanup and visibilitychange so both use the same logic.
  // Retries once on 409 conflict (stale canvasVersionRef on initial mount when
  // the env canvas version differs from the workflow canvas version).
  const flushPendingSave = async (opts?: { keepalive?: boolean }) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (!saveTimerRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const canvas = lastCanvasRef.current;
    const sess = sessionRef.current;
    if (
      !canSaveRef.current ||
      !workflowIdRef.current ||
      workflowIdRef.current === "new" ||
      !sess ||
      !canvas
    )
      return;
    const envId = currentEnvIdRef.current;
    const doSave = async (v: number) => {
      if (envId) {
        await saveEnvCanvas(
          workflowIdRef.current,
          envId,
          canvas,
          sess,
          v,
          opts,
        );
      } else {
        await saveCanvasApi(workflowIdRef.current, canvas, sess, v, opts);
      }
    };
    const version = canvasVersionRef.current;
    const flushedKey = authoringKey(
      (canvas.nodes ?? []) as Node[],
      (canvas.edges ?? []) as Edge[],
    );
    try {
      await doSave(version);
      canvasVersionRef.current = version + 1;
      lastSavedKeyRef.current = flushedKey;
    } catch (err) {
      if (err instanceof CanvasConflictError && err.currentVersion !== null) {
        // canvasVersionRef was stale (e.g. initial mount set workflow version
        // before env canvas version was loaded). Retry once with correct version.
        const correct = err.currentVersion;
        canvasVersionRef.current = correct;
        try {
          await doSave(correct);
          canvasVersionRef.current = correct + 1;
          lastSavedKeyRef.current = flushedKey;
        } catch {
          /* Best-effort — env switch will load authoritative server state */
        }
      }
    }
  };

  // Load workflow on mount
  useEffect(() => {
    if (workflowId === "new") {
      canSaveRef.current = true;
      const pending = localStorage.getItem("pendingStackCanvas");
      if (pending) {
        try {
          const {
            nodes: n,
            edges: e,
            _name,
            _workflowId,
            _chatHistory,
          } = JSON.parse(pending);
          if (_name) {
            setWorkflowName(_name);
            workflowNameRef.current = _name;
          }
          // Reuse the draft workflow created during the /new conversation
          // instead of creating a brand-new one on first canvas save.
          if (_workflowId) {
            workflowIdRef.current = _workflowId;
            setCurrentWorkflowId(_workflowId);
            navigate({
              to: "/console/projects/$id/canvas",
              params: { id: _workflowId },
              replace: true,
            });
          }
          if (_chatHistory?.length) {
            setInitialChatMessages(_chatHistory);
          }
          setNodes(n ?? []);
          setEdges(e ?? []);
          localStorage.removeItem("pendingStackCanvas");
          setTimeout(() => fitView({ padding: 0.2 }), 50);
        } catch {
          localStorage.removeItem("pendingStackCanvas");
        }
      }
      return;
    }
    getProject(workflowId)
      .then((wf) => {
        setWorkflowName(wf.name);
        workflowNameRef.current = wf.name;
        workflowIdRef.current = wf.id;
        canvasVersionRef.current = wf.canvas_version ?? 0;
        setWorkflowStatus(wf.status);

        // If canvas is empty and a template was requested, populate it
        const hasNodes =
          Array.isArray(wf.canvas.nodes) && wf.canvas.nodes.length > 0;
        if (!hasNodes && template) {
          const canvas = buildTemplateCanvas(template);
          if (canvas) {
            setNodes(canvas.nodes as Node[]);
            setEdges(canvas.edges as Edge[]);
            // Template is written to the server right here, so treat it as the
            // saved baseline — the debounced auto-save must not write it again.
            resetBaseline(canvas.nodes as Node[], canvas.edges as Edge[]);
            if (session)
              saveCanvasApi(
                wf.id,
                canvas,
                session,
                canvasVersionRef.current,
              ).catch(() => {});
            setTimeout(() => {
              fitView({ padding: 0.25 });
              canSaveRef.current = true;
            }, 100);
            return;
          }
        }

        // The project canvas is NOT rendered here for real (non-template,
        // non-"new") projects. loadEnvCanvas (WorkspaceCanvas.tsx) is the sole
        // populator of nodes/edges/viewport/baseline and the sole flipper of
        // canSaveRef for real projects — rendering the project canvas here would
        // cause a visible flash (project canvas → env canvas) and would let
        // canSaveRef flip true before canvasVersionRef is corrected to the env
        // version, allowing a premature auto-save against the wrong version.
        // The backup-restore check likewise moved to loadEnvCanvas, where it can
        // compare the backup against the env canvas (the endpoint saves target)
        // instead of the vestigial project canvas.
        // canvasVersionRef.current was set to the project version above as a
        // harmless fallback; loadEnvCanvas overwrites it with the env version.

        if (
          wf.canvas.nodes?.some(
            (n: Node) =>
              (n.data as Record<string, unknown>)?.status === "provisioned",
          )
        ) {
          healthCheckWorkflowRef.current = wf.id;
        }
      })
      .catch(() => {
        toast.error("Workflow not found or you do not have access.");
        navigate({ to: "/console", replace: true });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Health check for provisioned nodes once session is available
  useEffect(() => {
    const wfId = healthCheckWorkflowRef.current;
    if (!session || !wfId) return;
    healthCheckWorkflowRef.current = null;
    checkWorkflowResourceHealth(wfId, session)
      .then((results) => {
        const dead = results.filter((r) => !r.alive);
        if (!dead.length) return;
        // Writes only runtime fields (status/errorMsg) into node.data for display;
        // authoringKey ignores them, so this never triggers an auto-save.
        setNodes((prev: Node[]) =>
          prev.map((n: Node) => {
            if (!dead.some((d) => d.nodeId === n.id)) return n;
            return {
              ...n,
              data: {
                ...(n.data as Record<string, unknown>),
                status: "error",
                errorMsg:
                  "Project was deleted on the provider. Re-provision to restore.",
              },
            };
          }),
        );
        toast.warning(
          `${dead.length} node${dead.length > 1 ? "s" : ""} deleted outside Leenar — status updated.`,
          { duration: 6000 },
        );
      })
      .catch(() => {
        /* silent */
      });
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-save
  useEffect(() => {
    if (!canSaveRef.current) return;
    // Only persist genuine authoring changes. Runtime-only node mutations
    // (provision status, drift/incident counts, usage) leave the authoring key
    // unchanged, so this short-circuits and never issues a redundant write.
    const changeKey = authoringKey(nodes, edges);
    if (changeKey === lastSavedKeyRef.current) return;
    // Snapshot the canvas as pure authoring intent (runtime data stripped) while
    // React + ReactFlow are fully live. The persisted canvas never carries
    // provisioned status, drift counts, or usage — those live in
    // project_env_node_state (server) and are re-merged on load for display.
    const { viewport } = toObject();
    lastCanvasRef.current = {
      nodes: nodes.map(stripRuntimeNode),
      edges,
      viewport,
    };
    // Write to localStorage immediately as a safety net. Cleared on successful server save.
    const wfId = workflowIdRef.current;
    if (wfId && wfId !== "new") {
      try {
        localStorage.setItem(
          backupKeyFor(wfId, currentEnvIdRef.current),
          JSON.stringify(lastCanvasRef.current),
        );
      } catch {
        /* localStorage full — skip backup */
      }
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveState("unsaved");

    const RETRY_DELAYS = [2000, 4000, 8000];

    // Capture canvas synchronously now (ReactFlow is live).
    // attemptSave runs async 1.5 s later — by then ReactFlow may have unmounted
    // (if the user navigated away), causing toObject() to return {nodes:[]}.
    // We never want to save an empty canvas over a real one.
    const savedCanvas = lastCanvasRef.current;

    const attemptSave = async (attempt: number): Promise<void> => {
      // Suppress saves while the canvas is locked by an active deployment.
      // Sending our local canvas (which may lack DO-patched node statuses) against
      // the server version would overwrite those patches and corrupt node state.
      if (lockStatusRef.current?.locked) {
        setSaveState("unsaved");
        saveTimerRef.current = null;
        return;
      }
      setSaveState("saving");
      // Capture outside try so catch/retry blocks can also reference these values
      const canvas = savedCanvas;
      const session = sessionRef.current;
      try {
        if (workflowIdRef.current === "new") {
          const wf = await createProject(workflowNameRef.current);
          workflowIdRef.current = wf.id;
          setCurrentWorkflowId(wf.id);
          navigate({
            to: "/console/projects/$id/canvas",
            params: { id: wf.id },
            replace: true,
          });
        }
        if (!session) throw new Error("Not authenticated");
        const envId = currentEnvIdRef.current;
        const version = canvasVersionRef.current;
        if (envId) {
          await saveEnvCanvas(
            workflowIdRef.current,
            envId,
            canvas,
            session,
            version,
          );
        } else {
          await saveCanvasApi(workflowIdRef.current, canvas, session, version);
        }
        canvasVersionRef.current = version + 1;
        retryCountRef.current = 0;
        lastSavedKeyRef.current = changeKey;
        localStorage.removeItem(
          backupKeyFor(workflowIdRef.current, currentEnvIdRef.current),
        );
        setSaveState("saved");
        saveTimerRef.current = null;
      } catch (err) {
        if (err instanceof CanvasConflictError) {
          // Version mismatch — usually caused by DO node patches during deploy.
          // Sync version and retry once. The local canvas already reflects any
          // DO-patched statuses (pushed via provisioning session polling), so
          // retrying with the corrected version is safe and avoids spurious toasts.
          const serverVersion = err.currentVersion;
          if (serverVersion !== null) canvasVersionRef.current = serverVersion;
          if (attempt === 0 && serverVersion !== null && session) {
            // Before silently retrying, confirm the version bump was a
            // no-authoring-impact event (DO node patch during deploy, or
            // another tab saving identical content) rather than a genuine
            // multi-tab conflict. Fetch the current server canvas and compare
            // its authoring content against what we're about to write —
            // overwriting is the dangerous direction, so any ambiguity here
            // (including the fetch itself failing) falls through to the
            // conflict toast instead of retrying.
            let serverMatchesLocal = false;
            try {
              const envId = currentEnvIdRef.current;
              const serverCanvas = envId
                ? await getEnvCanvas(workflowIdRef.current, envId, session)
                : (await getProject(workflowIdRef.current)).canvas;
              serverMatchesLocal = backupMatchesServer(
                { nodes: canvas.nodes ?? [], edges: canvas.edges ?? [] },
                {
                  nodes: serverCanvas.nodes ?? [],
                  edges: serverCanvas.edges ?? [],
                },
              );
            } catch {
              // Fetch failed — treat as non-matching, fall through to conflict toast.
              serverMatchesLocal = false;
            }
            if (serverMatchesLocal) {
              // Silent single retry with synced version
              try {
                const envId = currentEnvIdRef.current;
                if (envId) {
                  await saveEnvCanvas(
                    workflowIdRef.current,
                    envId,
                    canvas,
                    session,
                    serverVersion,
                  );
                } else {
                  await saveCanvasApi(
                    workflowIdRef.current,
                    canvas,
                    session,
                    serverVersion,
                  );
                }
                canvasVersionRef.current = serverVersion + 1;
                lastSavedKeyRef.current = changeKey;
                localStorage.removeItem(
                  backupKeyFor(workflowIdRef.current, currentEnvIdRef.current),
                );
                setSaveState("saved");
                return;
              } catch {
                // Retry also failed — fall through to surface the conflict
              }
            }
          }
          const backupKey = backupKeyFor(
            workflowIdRef.current,
            currentEnvIdRef.current,
          );
          const localJson = localStorage.getItem(backupKey);
          setSaveState("unsaved");
          toast.warning(
            "Canvas conflict detected — your changes were kept. Save again to sync.",
            {
              duration: 10000,
              action: {
                label: "Keep Server",
                onClick: () => {
                  localStorage.removeItem(backupKey);
                  window.location.reload();
                },
              },
            },
          );
          if (localJson) {
            console.warn(
              "[auto-save] canvas conflict — local backup preserved",
              { workflowId: workflowIdRef.current },
            );
          }
          return;
        }
        if (err instanceof CanvasLockedError) {
          setSaveState("unsaved");
          setLockStatus({
            locked: true,
            lockedAt: err.lockedAt,
            lockedBy: err.lockedBy,
            ageSeconds: 0,
          });
          toast.warning(
            "Canvas is locked by an active deployment — changes will sync when deploy finishes.",
            { duration: 8000 },
          );
          return;
        }
        // Transient failure — retry with exponential backoff before alarming the user
        if (attempt < RETRY_DELAYS.length) {
          const delay = RETRY_DELAYS[attempt];
          retryTimerRef.current = setTimeout(
            () => attemptSave(attempt + 1),
            delay,
          );
          return;
        }
        // All retries exhausted — surface the error
        retryCountRef.current = 0;
        const errMsg =
          err instanceof Error ? err.message : String(err ?? "unknown");
        console.error("[auto-save] failed after retries:", errMsg, {
          workflowId: workflowIdRef.current,
          envId: currentEnvIdRef.current,
        });
        setSaveState("unsaved");
        toast.error(
          `Auto-save failed (${errMsg}) — changes backed up locally`,
          { duration: 8000 },
        );
      }
    };

    saveTimerRef.current = setTimeout(() => attemptSave(0), 1500);
  }, [nodes, edges, lockStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // visibilitychange: flush pending save when tab goes to background.
  // Catches the "user switches tab / minimizes" case before unmount fires.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "hidden") flushPendingSave();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  // beforeunload: best-effort flush on hard reload/tab-close/external nav —
  // the only case visibilitychange/unmount don't reliably cover, since the
  // page may be torn down before a normal fetch completes. Uses
  // fetch(..., { keepalive: true }) (not navigator.sendBeacon, which can't
  // carry the Authorization header these endpoints require) so the request
  // keeps running in the background past unload. Not awaited — beforeunload
  // handlers can't block on async work. Fire-and-forget; no confirmation
  // dialog (no preventDefault/returnValue). Known limitation: keepalive
  // requests share a small combined payload cap (~64KB), so a very large
  // canvas may silently fail to send — accepted as a best-effort tradeoff.
  useEffect(() => {
    const handler = () => {
      flushPendingSave({ keepalive: true });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // On unmount: flush any pending save immediately using the last snapshot.
  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, []);

  // Keep lockStatusRef in sync so the save effect can read it at fire-time.
  useEffect(() => {
    lockStatusRef.current = lockStatus;
  }, [lockStatus]);

  // Poll lock-status every 10 s so the deploy panel can show Force Unlock after 5 min.
  // Uses currentWorkflowId state (not ref) so the effect re-runs when a new project
  // is created from the "new" route and the ID becomes available.
  useEffect(() => {
    if (!session || !currentWorkflowId || currentWorkflowId === "new") return;
    const poll = () => {
      getLockStatus(currentWorkflowId, session)
        .then((status) => setLockStatus(status))
        .catch(() => {});
    };
    poll();
    const id = setInterval(() => {
      if (isTabHidden()) return;
      poll();
    }, 10_000);
    return () => clearInterval(id);
  }, [session, currentWorkflowId]);

  return {
    workflowName,
    setWorkflowName,
    workflowStatus,
    workflowIdRef,
    workflowNameRef,
    canSaveRef,
    canvasVersionRef,
    healthCheckWorkflowRef,
    saveState,
    setSaveState,
    currentWorkflowId,
    setCurrentWorkflowId,
    initialChatMessages,
    lockStatus,
    setLockStatus,
    flushPendingSave,
    resetBaseline,
  };
}
