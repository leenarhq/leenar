import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuth } from "../context/auth";
import {
  listDeployments,
  fetchBuildLogs,
  type DeploymentSummary,
  type BuildLogEntry,
} from "../lib/api";
import { timeAgo } from "../lib/utils";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Clock,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/console/projects/$id/deployments")({
  component: DeploymentsPage,
});

function StatusIcon({ status }: { status: string }) {
  if (status === "success" || status === "ready")
    return <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />;
  if (status === "error" || status === "failed")
    return <XCircle size={16} className="text-destructive shrink-0" />;
  if (status === "running" || status === "provisioning")
    return (
      <Loader2 size={16} className="text-blue-400 animate-spin shrink-0" />
    );
  return <AlertCircle size={16} className="text-muted-foreground shrink-0" />;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    ready: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    error: "text-destructive bg-destructive/10 border-destructive/20",
    failed: "text-destructive bg-destructive/10 border-destructive/20",
    running: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    provisioning: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  };
  const cls =
    map[status] ?? "text-muted-foreground bg-secondary/40 border-border";
  return (
    <span
      className={`inline-flex rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}
    >
      {status}
    </span>
  );
}

function ProviderLink({
  service,
  ref_,
}: {
  service: string;
  ref_: {
    projectId?: string;
    deploymentId?: string;
    workerName?: string;
    versionId?: string;
    service: string;
  };
}) {
  const url = ref_.projectId
    ? service === "vercel"
      ? `https://vercel.com/dashboard/${ref_.projectId}`
      : service === "supabase"
        ? `https://supabase.com/dashboard/project/${ref_.projectId}`
        : null
    : null;
  return (
    <div className="flex items-center gap-1.5 rounded border border-border bg-secondary/30 px-2 py-1">
      <span className="font-mono text-[10px] uppercase text-muted-foreground">
        {service}
      </span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground"
        >
          <ExternalLink size={9} />
        </a>
      )}
    </div>
  );
}

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function logLineClass(type: string): string {
  if (type === "error") return "text-red-400";
  if (type === "warning") return "text-yellow-400";
  return "text-[#c9d1d9]";
}

function DeploymentsPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();

  const deploymentsQuery = useQuery({
    queryKey: ["deployments", id],
    queryFn: () => listDeployments(id, session!),
    enabled: !!session,
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<Record<string, BuildLogEntry[]>>(
    {},
  );
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);

  const toggleExpand = async (dep: DeploymentSummary) => {
    if (expanded === dep.id) {
      setExpanded(null);
      return;
    }
    setExpanded(dep.id);
    const vercelRef = dep.provider_refs?.vercel;
    if (vercelRef?.deploymentId && !buildLogs[dep.id] && session) {
      setLoadingLogs(dep.id);
      try {
        const logs = await fetchBuildLogs(vercelRef.deploymentId, session);
        setBuildLogs((prev) => ({ ...prev, [dep.id]: logs }));
      } catch {
        /* silent */
      } finally {
        setLoadingLogs((prev) => (prev === dep.id ? null : prev));
      }
    }
  };

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Deployments
              </h1>
              <p className="mt-0.5 text-sm text-foreground/70">
                {deploymentsQuery.data?.length ?? 0} total
              </p>
            </div>
            <button
              onClick={() => deploymentsQuery.refetch()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {/* Loading skeleton */}
          {deploymentsQuery.isLoading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-md border border-border bg-secondary/20"
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!deploymentsQuery.isLoading && !deploymentsQuery.data?.length && (
            <div className="rounded-md border border-dashed border-border py-24 text-center text-sm text-muted-foreground">
              No deployments yet
            </div>
          )}

          {/* Deployment list */}
          <div className="space-y-2">
            {deploymentsQuery.data?.map((dep) => (
              <div
                key={dep.id}
                className="rounded-md border border-border bg-card overflow-hidden"
              >
                {/* Summary row - clickable */}
                <button
                  onClick={() => toggleExpand(dep)}
                  className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-secondary/20 transition-colors"
                >
                  {/* Status icon */}
                  <StatusIcon status={dep.status} />

                  {/* Left: deployment ID + time */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-foreground">
                        #{dep.id.slice(0, 8)}
                      </span>
                      <StatusBadge status={dep.status} />
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{timeAgo(new Date(dep.started_at).getTime())}</span>
                      {dep.finished_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {formatDuration(dep.started_at, dep.finished_at)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: provider chips */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {Object.entries(dep.provider_refs ?? {}).map(([svc]) => (
                      <span
                        key={svc}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground"
                      >
                        {svc}
                      </span>
                    ))}
                  </div>

                  {/* Chevron */}
                  {expanded === dep.id ? (
                    <ChevronUp
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                  ) : (
                    <ChevronDown
                      size={14}
                      className="text-muted-foreground shrink-0"
                    />
                  )}
                </button>

                {/* Expanded: provider links + build logs */}
                {expanded === dep.id && (
                  <div className="border-t border-border">
                    {/* Provider links */}
                    <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-border">
                      {Object.entries(dep.provider_refs ?? {}).map(
                        ([svc, ref]) => (
                          <ProviderLink key={svc} service={svc} ref_={ref} />
                        ),
                      )}
                    </div>

                    {/* Build logs */}
                    <div className="px-4 py-3">
                      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        Build Logs
                      </p>
                      {loadingLogs === dep.id ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                          <Loader2 size={12} className="animate-spin" /> Loading
                          logs…
                        </div>
                      ) : buildLogs[dep.id]?.length ? (
                        <div
                          className="max-h-72 overflow-y-auto rounded-md p-3 font-mono text-[11px] leading-relaxed space-y-0.5"
                          style={{ background: "#0d1117" }}
                        >
                          {buildLogs[dep.id].map((log, i) => (
                            <div key={i} className={logLineClass(log.type)}>
                              <span className="text-[#484f58] mr-2 select-none">
                                {new Date(log.date).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </span>
                              {log.text}
                            </div>
                          ))}
                        </div>
                      ) : !dep.provider_refs?.vercel?.deploymentId ? (
                        <p className="text-[11px] text-muted-foreground py-2">
                          No Vercel deployment — build logs unavailable.
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground py-2">
                          No logs available.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
