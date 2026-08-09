import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "../context/auth";
import { isCloud } from "../lib/cloud";
import { supabase } from "../lib/supabase";
import { isTabHidden } from "../lib/visibility";
import {
  getProject,
  type ProjectSummary,
  type Project,
  subscribeToProvisioningSession,
} from "../lib/workflows";
import {
  listDrifts,
  listOpenIncidents,
  getWorkflowUsage,
  checkWorkflowResourceHealth,
  listEnvironments,
  getActiveDeploymentSession,
  getProjectUptime,
  getCostSummary,
  getObservability,
  getObservabilityHistory,
  type ObservabilityHistory,
  getAutopilotPolicy,
  listAutopilotActions,
  type StackDrift,
  type Incident,
  type NodeUsageData,
  type WorkflowEnvironment,
  type UptimeNodeSummary,
  type CostSummary,
  type ObservabilityData,
  type AutopilotLevel,
  type AutopilotAction,
} from "../lib/api";

interface Deployment {
  id: string;
  status: string;
  queued_at: string;
  finished_at: string | null;
}

export interface ActiveSession {
  stackId: string;
  sessionId: string;
}

export interface DashboardData {
  summary: ProjectSummary | null;
  canvas: Project["canvas"] | null;
  deployments: Deployment[];
  drifts: StackDrift[];
  incidents: Incident[];
  usage: Record<string, NodeUsageData>;
  health: Array<{ nodeId: string; alive: boolean }>;
  uptime: Record<string, UptimeNodeSummary>;
  cost: CostSummary | null;
  observability: ObservabilityData | null;
  observabilityHistory: ObservabilityHistory;
  environments: WorkflowEnvironment[];
  activeSession: ActiveSession | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  setDrifts: React.Dispatch<React.SetStateAction<StackDrift[]>>;
  setIncidents: React.Dispatch<React.SetStateAction<Incident[]>>;
  refetchHealth: () => Promise<void>;
  autopilotLevel: AutopilotLevel;
  autopilotActions: AutopilotAction[];
  setAutopilotLevel: React.Dispatch<React.SetStateAction<AutopilotLevel>>;
  setAutopilotActions: React.Dispatch<React.SetStateAction<AutopilotAction[]>>;
  refetchAutopilot: () => Promise<void>;
}

const POLL_INTERVAL_MS = 30_000;

export function useProjectDashboard(projectId: string): DashboardData {
  const { session } = useAuth();

  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [canvas, setCanvas] = useState<Project["canvas"] | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [drifts, setDrifts] = useState<StackDrift[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [usage, setUsage] = useState<Record<string, NodeUsageData>>({});
  const [health, setHealth] = useState<
    Array<{ nodeId: string; alive: boolean }>
  >([]);
  const [uptime, setUptime] = useState<Record<string, UptimeNodeSummary>>({});
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [observability, setObservability] = useState<ObservabilityData | null>(
    null,
  );
  const [observabilityHistory, setObservabilityHistory] =
    useState<ObservabilityHistory>({});
  const lastObsRef = useRef<number>(0);
  const [environments, setEnvironments] = useState<WorkflowEnvironment[]>([]);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(
    null,
  );
  const [autopilotLevel, setAutopilotLevel] =
    useState<AutopilotLevel>("observe");
  const [autopilotActions, setAutopilotActions] = useState<AutopilotAction[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubSessionRef = useRef<(() => void) | null>(null);

  const refetchHealth = useCallback(async () => {
    if (!session) return;
    try {
      const result = await checkWorkflowResourceHealth(projectId, session);
      setHealth(result);
    } catch {
      // silently ignore
    }
  }, [projectId, session]);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);

    try {
      const [
        sumRes,
        deplRes,
        project,
        driftRes,
        incRes,
        usageRes,
        healthRes,
        uptimeRes,
        envRes,
        sessionRes,
        costRes,
        autopilotPolicyRes,
        autopilotActionsRes,
      ] = await Promise.allSettled([
        supabase
          .from("project_summary")
          .select("*")
          .eq("id", projectId)
          .single(),
        supabase
          .from("project_deployments")
          .select("id, status, queued_at, finished_at")
          .eq("project_id", projectId)
          .order("queued_at", { ascending: false })
          .limit(30),
        getProject(projectId).catch(() => null),
        listDrifts(projectId, session).catch(() => []),
        isCloud
          ? listOpenIncidents(projectId, session).catch(() => [])
          : Promise.resolve([]),
        isCloud
          ? getWorkflowUsage(projectId, session).catch(() => ({ usage: {} }))
          : Promise.resolve({ usage: {} }),
        checkWorkflowResourceHealth(projectId, session).catch(() => []),
        isCloud
          ? getProjectUptime(projectId, session).catch(() => ({}))
          : Promise.resolve({}),
        listEnvironments(projectId, session).catch(() => []),
        getActiveDeploymentSession(projectId, session).catch(() => null),
        isCloud
          ? getCostSummary(projectId, session).catch(() => null)
          : Promise.resolve(null),
        isCloud
          ? getAutopilotPolicy(projectId, session).catch(() => ({
              level: "observe" as AutopilotLevel,
            }))
          : Promise.resolve({ level: "observe" as AutopilotLevel }),
        isCloud
          ? listAutopilotActions(projectId, session).catch(
              () => [] as AutopilotAction[],
            )
          : Promise.resolve([] as AutopilotAction[]),
      ]);

      if (sumRes.status === "fulfilled" && sumRes.value.data) {
        setSummary(sumRes.value.data as ProjectSummary);
      }
      if (deplRes.status === "fulfilled" && deplRes.value.data) {
        setDeployments(deplRes.value.data as Deployment[]);
      }
      if (project.status === "fulfilled" && project.value) {
        setCanvas(project.value.canvas);
      }
      if (driftRes.status === "fulfilled") setDrifts(driftRes.value);
      if (incRes.status === "fulfilled") setIncidents(incRes.value);
      if (usageRes.status === "fulfilled")
        setUsage(
          (usageRes.value as { usage: Record<string, NodeUsageData> }).usage ??
            {},
        );
      if (healthRes.status === "fulfilled") setHealth(healthRes.value);
      if (uptimeRes.status === "fulfilled") setUptime(uptimeRes.value);
      if (envRes.status === "fulfilled") setEnvironments(envRes.value);
      if (sessionRes.status === "fulfilled") setActiveSession(sessionRes.value);
      if (costRes.status === "fulfilled") setCost(costRes.value);
      if (autopilotPolicyRes.status === "fulfilled")
        setAutopilotLevel(autopilotPolicyRes.value.level);
      if (autopilotActionsRes.status === "fulfilled")
        setAutopilotActions(autopilotActionsRes.value);

      // Fetch observability at most once per 60 s (avoid hammering provider APIs)
      const now = Date.now();
      if (isCloud && now - lastObsRef.current > 60_000) {
        const [obsData, obsHistory] = await Promise.all([
          getObservability(projectId, session).catch(() => null),
          getObservabilityHistory(projectId, session).catch(() => ({})),
        ]);
        setObservability(obsData);
        setObservabilityHistory(obsHistory);
        lastObsRef.current = now;
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [projectId, session]);

  // Realtime: project_deployments INSERT/UPDATE
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`deployments:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_deployments",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          // Re-fetch deployments + summary on any change
          Promise.all([
            supabase
              .from("project_deployments")
              .select("id, status, queued_at, finished_at")
              .eq("project_id", projectId)
              .order("queued_at", { ascending: false })
              .limit(30),
            supabase
              .from("project_summary")
              .select("*")
              .eq("id", projectId)
              .single(),
          ]).then(([deplRes, sumRes]) => {
            if (deplRes.data) setDeployments(deplRes.data as Deployment[]);
            if (sumRes.data) setSummary(sumRes.data as ProjectSummary);
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, session]);

  // Realtime: incidents INSERT/UPDATE
  useEffect(() => {
    if (!isCloud) return;
    if (!session) return;

    const channel = supabase
      .channel(`incidents:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "incidents",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          listOpenIncidents(projectId, session)
            .then(setIncidents)
            .catch(() => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, session]);

  // Realtime: stack_drifts INSERT/UPDATE/DELETE
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`drifts:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stack_drifts",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          listDrifts(projectId, session)
            .then((drifts) => {
              setDrifts(drifts);
              refetchHealth();
            })
            .catch(() => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, session, refetchHealth]);

  // Realtime: autopilot_actions INSERT/UPDATE/DELETE
  useEffect(() => {
    if (!isCloud) return;
    if (!session) return;

    const channel = supabase
      .channel(`autopilot_actions:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "autopilot_actions",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          listAutopilotActions(projectId, session)
            .then(setAutopilotActions)
            .catch(() => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, session]);

  const refetchAutopilot = useCallback(async () => {
    if (!session) return;
    const [policy, actions] = await Promise.all([
      getAutopilotPolicy(projectId, session).catch(() => ({
        level: "observe" as AutopilotLevel,
      })),
      listAutopilotActions(projectId, session).catch(
        () => [] as AutopilotAction[],
      ),
    ]);
    setAutopilotLevel(policy.level);
    setAutopilotActions(actions);
  }, [projectId, session]);

  // Subscribe to active provisioning session for live progress
  useEffect(() => {
    if (!activeSession) {
      unsubSessionRef.current?.();
      unsubSessionRef.current = null;
      return;
    }

    unsubSessionRef.current?.();
    unsubSessionRef.current = subscribeToProvisioningSession(
      activeSession.sessionId,
      (ps) => {
        if (
          ps.status === "success" ||
          ps.status === "failed" ||
          ps.status === "cancelled"
        ) {
          // Refetch everything when session ends
          setActiveSession(null);
          load();
        }
      },
    );

    return () => {
      unsubSessionRef.current?.();
      unsubSessionRef.current = null;
    };
  }, [activeSession, load]);

  // Polling fallback every 30s
  useEffect(() => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(() => {
      if (isTabHidden()) return;
      if (session) load();
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [load, session]);

  // Initial load + reset on projectId change
  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setSummary(null);
    setCanvas(null);
    setDeployments([]);
    setDrifts([]);
    setIncidents([]);
    setUsage({});
    setHealth([]);
    setCost(null);
    setObservability(null);
    setObservabilityHistory({});
    lastObsRef.current = 0;
    setEnvironments([]);
    setActiveSession(null);
    setAutopilotLevel("observe");
    setAutopilotActions([]);
    load();
  }, [projectId, session]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    summary,
    canvas,
    deployments,
    drifts,
    incidents,
    usage,
    health,
    uptime,
    cost,
    observability,
    observabilityHistory,
    environments,
    activeSession,
    loading,
    error,
    refetch: load,
    setDrifts,
    setIncidents,
    refetchHealth,
    autopilotLevel,
    autopilotActions,
    setAutopilotLevel,
    setAutopilotActions,
    refetchAutopilot,
  };
}
