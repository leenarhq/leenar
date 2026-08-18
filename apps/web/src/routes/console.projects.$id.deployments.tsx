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
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { HairGrid, HairCell } from "../components/console/HairGrid";
import { Rows, Row, Mono, Dim } from "../components/console/Rows";
import { StateTag, StateDot, toneFor } from "../components/console/StateTag";
import { PILL_QUIET } from "../components/console/Field";

export const Route = createFileRoute("/console/projects/$id/deployments")({
  component: DeploymentsPage,
});

/**
 * StatusIcon and StatusBadge used to live here: two maps encoding the same
 * three tones, one as icons and one as six class strings. toneFor already
 * reads every status either of them knew.
 */
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
    <div className="flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1">
      <span className="font-mono text-[10px] lowercase text-muted-foreground">
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
  if (type === "error") return "text-crit";
  if (type === "warning") return "text-warn";
  return "text-foreground";
}

/** `today` / `yesterday` / `4 days ago` — the heading carries the date so no
 *  row has to repeat it. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.floor(
    (midnight.getTime() - d.setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function groupByDay(deployments: DeploymentSummary[]) {
  const out: Array<{ day: string; items: DeploymentSummary[] }> = [];
  for (const d of deployments) {
    const key = dayKey(d.started_at);
    const last = out[out.length - 1];
    if (last?.day === key) last.items.push(d);
    else out.push({ day: key, items: [d] });
  }
  return out;
}

/**
 * Three cells, not four. The design also asks for a rollback count, but
 * DeploymentSummary carries no rollback marker — the "rollback" values
 * elsewhere in lib/api.ts are autopilot action types and audit kinds. A
 * fourth cell would be invented, not measured.
 */
function Strip({ deployments }: { deployments: DeploymentSummary[] }) {
  const done = deployments.filter((d) => d.finished_at);
  const ok = done.filter((d) => d.status === "success" || d.status === "ready");
  const rate = done.length ? Math.round((ok.length / done.length) * 100) : null;

  const durations = done
    .map(
      (d) =>
        new Date(d.finished_at!).getTime() - new Date(d.started_at).getTime(),
    )
    .sort((a, b) => a - b);
  const median = durations.length
    ? durations[Math.floor(durations.length / 2)]
    : null;

  const lastFail = deployments.find(
    (d) => d.status === "error" || d.status === "failed",
  );

  const Cell = ({ label, value }: { label: string; value: string }) => (
    <HairCell className="p-4">
      <div className="font-mono text-[10px] lowercase tracking-wide text-dim">
        {label}
      </div>
      <div className="mt-2 text-[22px] leading-none tabular-nums">{value}</div>
    </HairCell>
  );

  return (
    <HairGrid cols={3}>
      <Cell label="success rate" value={rate == null ? "—" : `${rate}%`} />
      <Cell
        label="median build"
        value={median == null ? "—" : `${Math.round(median / 1000)}s`}
      />
      <Cell
        label="last failure"
        value={
          lastFail ? timeAgo(new Date(lastFail.started_at).getTime()) : "none"
        }
      />
    </HairGrid>
  );
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
        <div className="mx-auto max-w-4xl p-4 sm:p-6">
          {/* The <h1> is gone: this route sits under ProjectContextBar,
              whose crumb already reads `project / Deployments`. */}
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="font-mono text-[11px] lowercase tabular-nums text-muted-foreground">
              {deploymentsQuery.data?.length ?? 0} total
            </span>
            <button
              onClick={() => deploymentsQuery.refetch()}
              className={PILL_QUIET}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>

          {deploymentsQuery.isLoading && (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-2xl border border-border bg-card"
                />
              ))}
            </div>
          )}

          {!deploymentsQuery.isLoading && !deploymentsQuery.data?.length && (
            <div className="rounded-2xl border border-border py-24 text-center text-[13px] text-muted-foreground">
              No deployments yet
            </div>
          )}

          {!!deploymentsQuery.data?.length && (
            <>
              <Strip deployments={deploymentsQuery.data} />

              {groupByDay(deploymentsQuery.data).map((g) => (
                <div key={g.day} className="mt-6">
                  <div className="mb-2 font-mono text-[10px] lowercase tracking-wide text-dim">
                    {g.day}
                  </div>
                  <Rows>
                    {g.items.map((dep) => (
                      <div key={dep.id}>
                        <Row
                          onClick={() => toggleExpand(dep)}
                          className="cursor-pointer"
                        >
                          <StateDot tone={toneFor(dep.status)} />
                          <Mono>{dep.id.slice(0, 8)}</Mono>
                          <StateTag
                            tone={toneFor(dep.status)}
                            label={dep.status}
                          />
                          <span className="flex-1 text-muted-foreground">
                            {new Date(dep.started_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {dep.finished_at && (
                            <Dim>
                              {formatDuration(dep.started_at, dep.finished_at)}
                            </Dim>
                          )}
                          {Object.keys(dep.provider_refs ?? {}).map((svc) => (
                            <span
                              key={svc}
                              className="hidden shrink-0 rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-dim sm:inline"
                            >
                              {svc}
                            </span>
                          ))}
                          {expanded === dep.id ? (
                            <ChevronUp
                              size={14}
                              className="shrink-0 text-dim"
                            />
                          ) : (
                            <ChevronDown
                              size={14}
                              className="shrink-0 text-dim"
                            />
                          )}
                        </Row>

                        {expanded === dep.id && (
                          <div className="border-b border-border-soft">
                            <div className="flex flex-wrap gap-2 border-b border-border-soft px-4 py-3">
                              {Object.entries(dep.provider_refs ?? {}).map(
                                ([svc, ref]) => (
                                  <ProviderLink
                                    key={svc}
                                    service={svc}
                                    ref_={ref}
                                  />
                                ),
                              )}
                            </div>
                            <div className="px-4 py-3">
                              <p className="mb-2 font-mono text-[10px] lowercase tracking-wide text-dim">
                                build logs
                              </p>
                              {loadingLogs === dep.id ? (
                                <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
                                  <Loader2 size={12} className="animate-spin" />{" "}
                                  Loading logs…
                                </div>
                              ) : buildLogs[dep.id]?.length ? (
                                // Was `background: "#0d1117"` with #c9d1d9 text
                                // — GitHub-dark hardcoded, i.e. black on black
                                // in the light theme.
                                <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-border-soft bg-card p-3 font-mono text-[11px] leading-relaxed">
                                  {buildLogs[dep.id].map((log, i) => (
                                    <div
                                      key={i}
                                      className={logLineClass(log.type)}
                                    >
                                      <span className="mr-2 select-none text-dim">
                                        {new Date(log.date).toLocaleTimeString(
                                          [],
                                          {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            second: "2-digit",
                                          },
                                        )}
                                      </span>
                                      {log.text}
                                    </div>
                                  ))}
                                </div>
                              ) : !dep.provider_refs?.vercel?.deploymentId ? (
                                <p className="py-2 text-[12px] text-muted-foreground">
                                  No Vercel deployment — build logs unavailable.
                                </p>
                              ) : (
                                <p className="py-2 text-[12px] text-muted-foreground">
                                  No logs available.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </Rows>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
