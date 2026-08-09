import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/auth";
import { isCloud } from "../lib/cloud";
import { useProjectDashboard } from "../hooks/useProjectDashboard";
import { getProject } from "../lib/workflows";
import {
  listDeployments,
  rollbackDeployment,
  provisionWorkflow,
  getActiveDeploymentSession,
  cancelDeployment,
  type DeploymentSummary,
} from "../lib/api";
import { buildActivityFeed } from "../lib/activity";
import { OverviewHeader } from "../components/dashboard/OverviewHeader";
import { StatCards } from "../components/dashboard/StatCards";
import { DashboardBriefing } from "../components/dashboard/DashboardBriefing";
import { RecentDeployments } from "../components/dashboard/RecentDeployments";
import { ActivityPanel } from "../components/dashboard/ActivityPanel";
import { HealthOverview } from "../components/dashboard/HealthOverview";
import { EnvironmentsPanel } from "../components/dashboard/EnvironmentsPanel";
import { AutopilotPanel } from "../components/dashboard/AutopilotPanel";
import { DashboardAgent } from "../components/dashboard/DashboardAgent";

export const Route = createFileRoute("/console/projects/$id/overview")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const { session } = useAuth();
  const { id } = Route.useParams();
  const d = useProjectDashboard(id);
  const navigate = useNavigate();

  // Manage/Overview is gated on the project's first successful deploy.
  // Redirect draft/never-deployed projects back to Build. Guard on
  // `d.summary` being loaded so we don't redirect during initial load.
  useEffect(() => {
    if (d.summary && d.summary.status !== "active") {
      navigate({ to: "/console/projects/$id/canvas", params: { id } });
    }
  }, [d.summary, id, navigate]);

  const [redeploying, setRedeploying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deploymentHistory, setDeploymentHistory] = useState<
    DeploymentSummary[]
  >([]);

  const fetchHistory = useCallback(async () => {
    if (!session) return;
    try {
      setDeploymentHistory(await listDeployments(id, session));
    } catch {
      /* non-critical */
    }
  }, [id, session]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const handleRollback = useCallback(
    async (deploymentId: string) => {
      if (!session) return;
      try {
        await rollbackDeployment(id, deploymentId, session);
        d.refetch();
        void fetchHistory();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Rollback failed");
      }
    },
    [id, session, d, fetchHistory],
  );

  const handleRedeploy = async () => {
    if (!session || redeploying || !d.summary) return;
    setRedeploying(true);
    setActionError(null);
    try {
      const project = await getProject(id);
      await provisionWorkflow(id, project.canvas, session, d.summary.name);
      const active = await getActiveDeploymentSession(id, session).catch(
        () => null,
      );
      if (active) d.refetch();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Failed to start deployment",
      );
    } finally {
      setRedeploying(false);
    }
  };

  const handleCancel = async () => {
    if (!session || cancelling || !d.activeSession) return;
    setCancelling(true);
    setActionError(null);
    try {
      await cancelDeployment(d.activeSession.stackId, session);
      d.refetch();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Failed to cancel deployment",
      );
    } finally {
      setCancelling(false);
    }
  };

  if (d.loading) {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
        <div className="h-16 animate-pulse rounded-md border border-border bg-card" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  // Not-yet-deployed projects are redirected to Build by the effect above;
  // return the same loading UI here to avoid flashing the dashboard for a frame.
  if (d.summary && d.summary.status !== "active") {
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
        <div className="h-16 animate-pulse rounded-md border border-border bg-card" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-md border border-border bg-card"
            />
          ))}
        </div>
      </div>
    );
  }

  if (d.error) {
    return (
      <div className="mx-auto max-w-md p-16 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
        <p className="mt-3 text-sm text-destructive">{d.error}</p>
      </div>
    );
  }

  const activity = buildActivityFeed({
    deployments: d.deployments,
    drifts: d.drifts,
    incidents: d.incidents,
    environments: d.environments,
  });

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-6">
      {d.activeSession && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-4 py-2.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Deployment in
          progress…
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          {actionError}
        </div>
      )}

      <DashboardBriefing data={d} />

      <OverviewHeader
        summary={d.summary}
        activeSession={d.activeSession}
        onRedeploy={handleRedeploy}
        onCancel={handleCancel}
        redeploying={redeploying}
        cancelling={cancelling}
      />

      {isCloud && (
        <HealthOverview
          incidents={d.incidents}
          drifts={d.drifts}
          uptime={d.uptime}
          observability={d.observability}
        />
      )}

      <StatCards
        summary={d.summary}
        incidents={d.incidents}
        drifts={d.drifts}
        health={d.health}
        usage={d.usage}
      />

      <RecentDeployments
        deployments={deploymentHistory.slice(0, 6)}
        projectId={id}
        onRollback={handleRollback}
      />

      <ActivityPanel items={activity} />

      {d.environments.length > 0 && (
        <EnvironmentsPanel environments={d.environments} projectId={id} />
      )}

      {isCloud && (
        <AutopilotPanel
          projectId={id}
          level={d.autopilotLevel}
          actions={d.autopilotActions}
          session={session}
          onLevelChange={d.setAutopilotLevel}
          onActionsChange={d.setAutopilotActions}
        />
      )}

      {isCloud && session && (
        <DashboardAgent data={d} session={session} onActionDone={d.refetch} />
      )}
    </div>
  );
}
