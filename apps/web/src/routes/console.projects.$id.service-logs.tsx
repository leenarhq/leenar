import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, AlertCircle, Copy, Check, RefreshCw } from "lucide-react";
import { useAuth } from "../context/auth";
import { isCloud } from "../lib/cloud";
import {
  fetchProjectLogs,
  fetchBuildLogs,
  listAllIncidents,
  resolveIncident,
  acknowledgeIncident,
  type ProjectLogs,
  type BuildLogEntry,
  type Incident,
} from "../lib/api";

export const Route = createFileRoute("/console/projects/$id/service-logs")({
  component: ServiceLogsPage,
  head: () => ({ meta: [{ title: "Logs — Leenar Console" }] }),
});

type ServiceTab = "vercel" | "github" | "supabase" | "resend" | "incidents";

const STATE_COLOR: Record<string, string> = {
  READY: "rgba(52,211,153,0.85)",
  ERROR: "rgba(248,113,113,0.85)",
  BUILDING: "rgba(251,191,36,0.85)",
  CANCELED: "rgba(156,163,175,0.6)",
};

const SEVERITY_COLOR: Record<string, string> = {
  "5xx": "rgba(248,113,113,0.85)",
  error: "rgba(248,113,113,0.85)",
  warning: "rgba(251,191,36,0.85)",
};

const STATUS_COLOR: Record<string, string> = {
  open: "rgba(248,113,113,0.85)",
  acknowledged: "rgba(251,191,36,0.85)",
  resolved: "rgba(52,211,153,0.85)",
};

const LOG_TYPE_COLOR: Record<string, string> = {
  command: "rgba(251,191,36,0.85)",
  stderr: "rgba(248,113,113,0.85)",
  exit: "rgba(248,113,113,0.85)",
};

function timeAgoLocal(ts: string | number): string {
  const ms = typeof ts === "number" ? ts : new Date(ts).getTime();
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatLogTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

// ─── VercelLogsPanel ────────────────────────────────────────────────────────

interface VercelLogsPanelProps {
  vercel: NonNullable<ProjectLogs["vercel"]>;
  projectId: string;
  session: ReturnType<typeof useAuth>["session"];
}

function VercelLogsPanel({
  vercel,
  projectId: _projectId,
  session,
}: VercelLogsPanelProps) {
  const [innerTab, setInnerTab] = useState<"deployments" | "build">(
    "deployments",
  );
  const [selectedDeployId, setSelectedDeployId] = useState<string>(
    vercel.deployments[0]?.id ?? "",
  );
  const [buildLogs, setBuildLogs] = useState<BuildLogEntry[]>([]);
  const [buildLoading, setBuildLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadBuildLogs = useCallback(
    async (deployId: string) => {
      if (!session || !deployId) return;
      setBuildLoading(true);
      try {
        const logs = await fetchBuildLogs(deployId, session);
        setBuildLogs(logs);
      } catch {
        setBuildLogs([]);
      } finally {
        setBuildLoading(false);
      }
    },
    [session],
  );

  useEffect(() => {
    if (innerTab === "build" && selectedDeployId) {
      void loadBuildLogs(selectedDeployId);
    }
  }, [innerTab, selectedDeployId, loadBuildLogs]);

  const handleCopy = () => {
    const text = buildLogs.map((l) => l.text).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-4 pt-4">
        <div className="flex gap-4">
          {(["deployments", "build"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setInnerTab(t)}
              className={`pb-2 text-sm capitalize transition-colors ${
                innerTab === t
                  ? "border-b-2 border-foreground text-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "deployments" ? "Deployments" : "Build Logs"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {innerTab === "deployments" && (
          <div className="space-y-2">
            {vercel.deployments.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No deployments found.
              </p>
            )}
            {vercel.deployments.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center justify-between rounded-md border border-border bg-secondary/40 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-background"
                    style={{
                      background:
                        STATE_COLOR[dep.state] ?? "rgba(156,163,175,0.6)",
                    }}
                  >
                    {dep.state}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {dep.commitMessage ?? "(no commit message)"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dep.branch ?? dep.commitRef ?? "—"} ·{" "}
                      {timeAgoLocal(dep.createdAt)}
                    </p>
                  </div>
                </div>
                {dep.url && (
                  <a
                    href={`https://${dep.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-3 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Open ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {innerTab === "build" && (
          <div>
            <div className="mb-3 flex items-center gap-3">
              <select
                value={selectedDeployId}
                onChange={(e) => setSelectedDeployId(e.target.value)}
                className="max-w-[20rem] truncate rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                {vercel.deployments.map((dep) => {
                  const label = dep.commitMessage ?? dep.id;
                  const short =
                    label.length > 48 ? `${label.slice(0, 48)}…` : label;
                  return (
                    <option key={dep.id} value={dep.id}>
                      {short} ({dep.state})
                    </option>
                  );
                })}
              </select>
              <button
                onClick={handleCopy}
                disabled={buildLogs.length === 0}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            {buildLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : buildLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No build logs available.
              </p>
            ) : (
              <pre className="overflow-auto rounded-md border border-border bg-background p-4 text-xs leading-relaxed">
                {buildLogs.map((line, i) => (
                  <span
                    key={i}
                    style={{
                      color: LOG_TYPE_COLOR[line.type] ?? "inherit",
                    }}
                  >
                    <span className="mr-2 select-none text-muted-foreground/60">
                      {formatLogTime(line.date)}
                    </span>
                    {line.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── IncidentsList ───────────────────────────────────────────────────────────

interface IncidentsListProps {
  incidents: Incident[];
  session: ReturnType<typeof useAuth>["session"];
  onIncidentsChange: (incidents: Incident[]) => void;
  projectId: string;
}

function IncidentsList({
  incidents,
  session,
  onIncidentsChange,
  projectId: _projectId,
}: IncidentsListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<Set<string>>(new Set());

  if (incidents.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        No incidents found.
      </div>
    );
  }

  // Group by service
  const grouped: Record<string, Incident[]> = {};
  for (const inc of incidents) {
    (grouped[inc.service] ??= []).push(inc);
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAcknowledge = async (incident: Incident) => {
    if (!session) return;
    setActing((prev) => new Set(prev).add(incident.id));
    try {
      await acknowledgeIncident(incident.id, session);
      onIncidentsChange(
        incidents.map((i) =>
          i.id === incident.id ? { ...i, status: "acknowledged" as const } : i,
        ),
      );
    } finally {
      setActing((prev) => {
        const next = new Set(prev);
        next.delete(incident.id);
        return next;
      });
    }
  };

  const handleResolve = async (incident: Incident) => {
    if (!session) return;
    setActing((prev) => new Set(prev).add(incident.id));
    try {
      await resolveIncident(incident.id, session);
      onIncidentsChange(
        incidents.map((i) =>
          i.id === incident.id
            ? {
                ...i,
                status: "resolved" as const,
                resolved_at: new Date().toISOString(),
              }
            : i,
        ),
      );
    } finally {
      setActing((prev) => {
        const next = new Set(prev);
        next.delete(incident.id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([service, items]) => (
        <div key={service} className="rounded-md border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {service}
            </span>
          </div>
          <div className="divide-y divide-border">
            {items.map((inc) => (
              <div key={inc.id} className="px-4 py-3">
                <div
                  className="flex cursor-pointer items-start justify-between gap-3"
                  onClick={() => toggleExpand(inc.id)}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <span
                      className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-background"
                      style={{
                        background:
                          SEVERITY_COLOR[inc.severity] ??
                          "rgba(156,163,175,0.6)",
                      }}
                    >
                      {inc.severity}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">
                        {inc.path ?? inc.resource_id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {inc.count > 0 && `${inc.count} occurrences · `}
                        {timeAgoLocal(inc.last_seen_at)}
                      </p>
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-background"
                    style={{
                      background:
                        STATUS_COLOR[inc.status] ?? "rgba(156,163,175,0.6)",
                    }}
                  >
                    {inc.status}
                  </span>
                </div>

                {expanded.has(inc.id) && (
                  <div className="mt-3 space-y-3">
                    {inc.log_snippet && (
                      <pre className="overflow-auto rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
                        {inc.log_snippet}
                      </pre>
                    )}
                    <div className="flex gap-2">
                      {inc.status === "open" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleAcknowledge(inc);
                          }}
                          disabled={acting.has(inc.id)}
                          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          {acting.has(inc.id) ? "…" : "Acknowledge"}
                        </button>
                      )}
                      {inc.status !== "resolved" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleResolve(inc);
                          }}
                          disabled={acting.has(inc.id)}
                          className="rounded-md border border-border bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90 disabled:opacity-40"
                        >
                          {acting.has(inc.id) ? "…" : "Mark resolved"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

function ServiceLogsPage() {
  const { id } = Route.useParams();
  const { session } = useAuth();

  const [logs, setLogs] = useState<ProjectLogs | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ServiceTab>("vercel");
  const tabRef = useRef<ServiceTab>("vercel");
  const [refreshing, setRefreshing] = useState(false);

  // Keep ref in sync so load() always sees the latest tab without being a dep
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!session) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [logsData, incidentsData] = await Promise.all([
          fetchProjectLogs(id, session),
          // /api/incidents is cloud-only. Both promises share one catch, so an
          // ungated 404 here failed the whole page — logs included — instead of
          // just dropping the Incidents tab.
          isCloud ? listAllIncidents(id, session) : Promise.resolve([]),
        ]);
        setLogs(logsData);
        setIncidents(incidentsData);

        // Auto-select first available tab (use ref to get live tab value)
        const tabs: ServiceTab[] = [];
        if (logsData.vercel) tabs.push("vercel");
        if (logsData.github) tabs.push("github");
        if (logsData.supabase) tabs.push("supabase");
        if (logsData.resend) tabs.push("resend");
        if (incidentsData.length > 0) tabs.push("incidents");
        if (tabs.length > 0 && !tabs.includes(tabRef.current)) setTab(tabs[0]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load logs");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, session],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const availableTabs: ServiceTab[] = [];
  if (logs?.vercel) availableTabs.push("vercel");
  if (logs?.github) availableTabs.push("github");
  if (logs?.supabase) availableTabs.push("supabase");
  if (logs?.resend) availableTabs.push("resend");
  if (incidents.length > 0) availableTabs.push("incidents");

  const tabLabel: Record<ServiceTab, string> = {
    vercel: "Vercel",
    github: "GitHub",
    supabase: "Supabase",
    resend: "Resend",
    incidents: `Incidents (${incidents.length})`,
  };

  return (
    <>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              Logs
            </h1>
            <button
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="mx-auto max-w-md py-16 text-center">
              <AlertCircle className="mx-auto h-6 w-6 text-destructive" />
              <p className="mt-3 text-sm text-destructive">{error}</p>
            </div>
          ) : (
            <>
              {/* Tab bar */}
              {availableTabs.length > 0 && (
                <div className="mb-6 flex gap-6 border-b border-border">
                  {availableTabs.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`pb-2 text-sm transition-colors ${
                        tab === t
                          ? "border-b-2 border-foreground text-foreground font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {tabLabel[t]}
                    </button>
                  ))}
                </div>
              )}

              {/* Tab content */}
              {availableTabs.length === 0 && (
                <div className="rounded-md border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
                  No service logs available for this project.
                </div>
              )}

              {tab === "vercel" && logs?.vercel && (
                <VercelLogsPanel
                  vercel={logs.vercel}
                  projectId={id}
                  session={session}
                />
              )}

              {tab === "github" && logs?.github && (
                <div className="rounded-md border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-sm font-medium text-foreground">
                      {logs.github.repoName}
                    </p>
                  </div>
                  <div className="divide-y divide-border">
                    {logs.github.commits.length === 0 && (
                      <p className="p-4 text-sm text-muted-foreground">
                        No commits found.
                      </p>
                    )}
                    {logs.github.commits.map((commit) => (
                      <div
                        key={commit.sha}
                        className="flex items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">
                            {commit.message}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            <span className="font-mono">
                              {commit.sha.slice(0, 7)}
                            </span>
                            {" · "}
                            {commit.author}
                            {" · "}
                            {timeAgoLocal(commit.date)}
                          </p>
                        </div>
                        <a
                          href={commit.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                        >
                          View ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "supabase" && logs?.supabase && (
                <div className="rounded-md border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {logs.supabase.name}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {logs.supabase.ref}
                      </p>
                    </div>
                    <span
                      className="rounded px-2 py-1 text-xs font-medium text-background"
                      style={{
                        background:
                          logs.supabase.status === "ACTIVE_HEALTHY"
                            ? "rgba(52,211,153,0.85)"
                            : "rgba(251,191,36,0.85)",
                      }}
                    >
                      {logs.supabase.status}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Region</p>
                      <p className="text-foreground">{logs.supabase.region}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Created</p>
                      <p className="text-foreground">
                        {timeAgoLocal(logs.supabase.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {tab === "resend" && logs?.resend && (
                <div className="rounded-md border border-border bg-card">
                  <div className="divide-y divide-border">
                    {logs.resend.emails.length === 0 && (
                      <p className="p-4 text-sm text-muted-foreground">
                        No emails found.
                      </p>
                    )}
                    {logs.resend.emails.map((email) => (
                      <div
                        key={email.id}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">
                            {email.subject}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {email.from} → {email.to.join(", ")}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {timeAgoLocal(email.createdAt)}
                          </p>
                        </div>
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-background"
                          style={{
                            background:
                              email.lastEvent === "delivered"
                                ? "rgba(52,211,153,0.85)"
                                : email.lastEvent === "bounced"
                                  ? "rgba(248,113,113,0.85)"
                                  : "rgba(251,191,36,0.85)",
                          }}
                        >
                          {email.lastEvent}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "incidents" && (
                <IncidentsList
                  incidents={incidents}
                  session={session}
                  onIncidentsChange={setIncidents}
                  projectId={id}
                />
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
