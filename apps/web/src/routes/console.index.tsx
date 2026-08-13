import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  Plus,
  MoreHorizontal,
  GitBranch,
  Boxes,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { ConsoleTopBar } from "./console";
import { useAuth } from "../context/auth";
import {
  getProjects,
  createProject,
  duplicateProject,
  renameProject,
  type ProjectSummary,
  type ProjectStatus,
} from "../lib/workflows";
import {
  getProjectsHealthOverview,
  type ProjectHealthSnapshot,
} from "../lib/api";
import { timeAgo } from "../lib/utils";
import { hasPendingPrompt } from "../lib/pendingPrompt";
import { NOUNS, statusLabel, statusTone } from "../lib/labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { ScanAccountsModal } from "../components/canvas/ScanAccountsModal";
import { DeleteProjectDialog } from "../components/console/DeleteProjectDialog";

export const Route = createFileRoute("/console/")({
  component: ProjectsPage,
  head: () => ({ meta: [{ title: "Projects — Leenar Console" }] }),
});

type SortKey = "updated" | "created" | "name" | "deploys";
type StatusFilter = "all" | ProjectStatus;

const toneMeta: Record<
  ReturnType<typeof statusTone>,
  { dot: string; text: string }
> = {
  positive: { dot: "bg-emerald-500", text: "text-emerald-400" },
  neutral: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
  warning: { dot: "bg-destructive", text: "text-destructive" },
};

function ProjectsPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("updated");
  const [showScanModal, setShowScanModal] = useState(false);

  /**
   * Sign-up and sign-in both land here. Someone who arrived by typing a prompt
   * into the landing hero is on their way to the chat, not to an empty project
   * list — /console/new picks the prompt up and sends it.
   */
  useEffect(() => {
    if (hasPendingPrompt()) navigate({ to: "/console/new", replace: true });
  }, [navigate]);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
  });
  const healthQuery = useQuery({
    queryKey: ["projects-health"],
    queryFn: () =>
      session ? getProjectsHealthOverview(session) : Promise.resolve({}),
    enabled: !!session,
  });

  const createMut = useMutation({
    mutationFn: (name: string) => createProject(name),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      navigate({ to: "/console/projects/$id", params: { id: p.id } });
    },
  });
  const duplicateMut = useMutation({
    mutationFn: (id: string) => duplicateProject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameProject(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);

  const projects = projectsQuery.data ?? [];
  const health: Record<string, ProjectHealthSnapshot> = healthQuery.data ?? {};

  const counts = useMemo(() => {
    const c = { all: projects.length, active: 0, draft: 0, error: 0 };
    for (const p of projects) c[p.status]++;
    return c;
  }, [projects]);

  const visible = useMemo(() => {
    let list = projects;
    if (status !== "all") list = list.filter((p) => p.status === status);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q));
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "name":
          return a.name.localeCompare(b.name);
        case "created":
          return b.created_at.localeCompare(a.created_at);
        case "deploys":
          return b.deploy_count - a.deploy_count;
        default:
          return b.updated_at.localeCompare(a.updated_at);
      }
    });
    return sorted;
  }, [projects, status, search, sort]);

  const filters: { key: StatusFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: counts.all },
    { key: "active", label: statusLabel("active"), count: counts.active },
    { key: "draft", label: statusLabel("draft"), count: counts.draft },
    { key: "error", label: statusLabel("error"), count: counts.error },
  ];

  return (
    <>
      <ConsoleTopBar title="Projects" />

      <div className="flex items-center justify-between gap-4 border-b border-dashed border-border px-6 py-3">
        <div className="relative w-[360px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full rounded-md border border-border bg-secondary/30 py-1.5 pl-9 pr-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border p-0.5">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatus(f.key)}
                className={`rounded px-2.5 py-1 text-xs transition-colors ${
                  status === f.key
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}{" "}
                <span className="text-muted-foreground">{f.count}</span>
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs focus:outline-none"
          >
            <option value="updated">Last updated</option>
            <option value="created">Newest first</option>
            <option value="name">Name A–Z</option>
            <option value="deploys">Most deployed</option>
          </select>
          <button
            onClick={() => setShowScanModal(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs hover:bg-secondary"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import existing
          </button>
          <button
            onClick={() => createMut.mutate("New Project")}
            disabled={createMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {createMut.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}{" "}
            Add New
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {projectsQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-md border border-border bg-card"
              />
            ))}
          </div>
        ) : projectsQuery.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-8 text-center text-sm text-destructive">
            Failed to load projects. {(projectsQuery.error as Error)?.message}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-24 text-center">
            <Boxes className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm">
              {search || status !== "all"
                ? "No matching projects"
                : "No projects yet"}
            </p>
            <button
              onClick={() => createMut.mutate("New Project")}
              className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover:opacity-90"
            >
              <Plus className="h-3 w-3" /> Create your first project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                healthDot={healthDot(health[p.id])}
                onOpen={() =>
                  navigate({
                    to: "/console/projects/$id",
                    params: { id: p.id },
                  })
                }
                onRename={() => {
                  const name = window.prompt("Rename project", p.name);
                  if (name && name !== p.name)
                    renameMut.mutate({ id: p.id, name });
                }}
                onDuplicate={() => duplicateMut.mutate(p.id)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </div>
        )}
      </div>
      <AnimatePresence>
        {showScanModal && session && (
          <motion.div
            className="fixed inset-0 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <ScanAccountsModal
              session={session}
              onClose={() => setShowScanModal(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {deleteTarget && session && (
        <DeleteProjectDialog
          project={deleteTarget}
          session={session}
          open={true}
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
          onDeleted={() => {
            qc.invalidateQueries({ queryKey: ["projects"] });
            setDeleteTarget(null);
          }}
        />
      )}
    </>
  );
}

type HealthTone = "ok" | "warn" | "crit";
function healthDot(h?: {
  critical_incidents: number;
  total_incidents: number;
  critical_drifts: number;
  total_drifts: number;
}): HealthTone {
  if (!h) return "ok";
  if (h.critical_incidents > 0 || h.critical_drifts > 0) return "crit";
  if (h.total_incidents > 0 || h.total_drifts > 0) return "warn";
  return "ok";
}
const healthToneClass: Record<HealthTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-yellow-500",
  crit: "bg-destructive",
};

function ProjectCard({
  project: p,
  healthDot,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  project: ProjectSummary;
  healthDot: HealthTone;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const tone = toneMeta[statusTone(p.status)];
  const label = statusLabel(p.status);
  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/20 hover:bg-secondary/20"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${healthToneClass[healthDot]}`}
            title={`health: ${healthDot}`}
          />
          <span className="truncate text-sm font-medium">{p.name}</span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs">
        <span className={`inline-flex items-center gap-1 ${tone.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} /> {label}
        </span>
        <span className="text-muted-foreground">
          ·{" "}
          {p.last_deployed_at
            ? `deployed ${timeAgo(new Date(p.last_deployed_at).getTime())}`
            : "never deployed"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Boxes className="h-3 w-3" /> {p.node_count}{" "}
          {NOUNS.service.toLowerCase()}s
        </span>
        <span className="inline-flex items-center gap-1">
          <GitBranch className="h-3 w-3" /> {p.edge_count}{" "}
          {NOUNS.connection.toLowerCase()}s
        </span>
        <span className="inline-flex items-center gap-1">
          <CloudUpload className="h-3 w-3" /> {p.deploy_count} deploys
        </span>
      </div>
    </div>
  );
}
