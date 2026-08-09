import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { useAuth } from "../context/auth";
import { isCloud } from "../lib/cloud";
import { useProjectDashboard } from "../hooks/useProjectDashboard";
import { HealthPanel } from "../components/dashboard/HealthPanel";
import { UptimePanel } from "../components/dashboard/UptimePanel";
import { ObservabilityPanel } from "../components/dashboard/ObservabilityPanel";
import { IncidentsPanel } from "../components/dashboard/IncidentsPanel";
import { DriftPanel } from "../components/dashboard/DriftPanel";
import { AlertRulesPanel } from "../components/dashboard/AlertRulesPanel";
import { CostPanel } from "../components/dashboard/CostPanel";
import { UsagePanel } from "../components/dashboard/UsagePanel";

export const Route = createFileRoute("/console/projects/$id/logs")({
  component: ProjectObservabilityPage,
  head: () => ({ meta: [{ title: "Observability — Leenar Console" }] }),
});

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h2>
  );
}

function ProjectObservabilityPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const d = useProjectDashboard(id);
  const canvasLike = d.canvas as any;

  if (d.loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-4 p-6">
      {/* Health & Uptime */}
      <GroupHeading>Health &amp; Uptime</GroupHeading>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {isCloud && <UptimePanel uptime={d.uptime} canvas={canvasLike} />}
        <div className="lg:col-span-2">
          <HealthPanel
            health={d.health}
            drifts={d.drifts}
            canvas={canvasLike}
          />
        </div>
      </div>

      {isCloud && (
        <>
          {/* Observability — one card per provider */}
          <GroupHeading>Observability</GroupHeading>
          <ObservabilityPanel
            observability={d.observability}
            history={d.observabilityHistory}
          />
        </>
      )}

      {isCloud && (
        <>
          {/* Incidents & Drift */}
          <GroupHeading>Incidents &amp; Drift</GroupHeading>
          {(d.drifts.length > 0 || d.incidents.length > 0) && (
            <div
              className={`grid grid-cols-1 gap-4 ${
                d.drifts.length > 0 && d.incidents.length > 0
                  ? "lg:grid-cols-2"
                  : ""
              }`}
            >
              {d.incidents.length > 0 && (
                <IncidentsPanel
                  incidents={d.incidents}
                  session={session}
                  onIncidentsChange={d.setIncidents}
                  projectId={id}
                />
              )}
              {d.drifts.length > 0 && (
                <DriftPanel
                  drifts={d.drifts}
                  session={session}
                  onDriftsChange={d.setDrifts}
                />
              )}
            </div>
          )}
          {d.drifts.length === 0 && d.incidents.length === 0 && (
            <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              No active incidents or drifts detected
            </div>
          )}
          <AlertRulesPanel projectId={id} session={session} />
        </>
      )}

      {isCloud && (
        <>
          {/* Cost & Usage */}
          <GroupHeading>Cost &amp; Usage</GroupHeading>
          <CostPanel cost={d.cost} incidents={d.incidents} />
          {Object.keys(d.usage).length > 0 && (
            <UsagePanel
              usage={d.usage}
              canvas={canvasLike}
              deployments={d.deployments}
            />
          )}
        </>
      )}
    </div>
  );
}
