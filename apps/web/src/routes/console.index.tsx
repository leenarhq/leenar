import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, MoreHorizontal, Loader2, ChevronDown } from "lucide-react";
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
import { NOUNS, statusLabel } from "../lib/labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../components/ui/dialog";
import { HairGrid, HairCell } from "../components/console/HairGrid";
import { StateDot, toneFor, type Tone } from "../components/console/StateTag";
import { ScanAccountsModal } from "../components/canvas/ScanAccountsModal";
import { DeleteProjectDialog } from "../components/console/DeleteProjectDialog";

export const Route = createFileRoute("/console/")({
  component: ProjectsPage,
  head: () => ({ meta: [{ title: "Projects — Leenar Console" }] }),
});

type SortKey = "updated" | "created" | "name" | "deploys";
type StatusFilter = "all" | ProjectStatus;

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last updated",
  created: "Newest first",
  name: "Name A–Z",
  deploys: "Most deployed",
};

/** One dot per project. Health outranks status: a live project with a
 *  critical drift is not "live" as far as the eye is concerned. */
function projectTone(p: ProjectSummary, h?: ProjectHealthSnapshot): Tone {
  if (h && (h.critical_incidents > 0 || h.critical_drifts > 0)) return "crit";
  if (h && (h.total_incidents > 0 || h.total_drifts > 0)) return "warn";
  return toneFor(p.status);
}

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
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);

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
      <ConsoleTopBar
        title={
          <span className="flex items-center gap-2.5">
            Projects
            <span className="font-mono text-[10px] tabular-nums text-dim">
              {projects.length}
            </span>
          </span>
        }
        right={
          <>
            {/* Hidden on the narrowest widths: the bar carries the title,
                both of these and TopBarActions, and at 390px that overflows.
                Mobile is deferred, but it still has to work — so the
                secondary action is the one that goes. */}
            <button
              onClick={() => setShowScanModal(true)}
              className="hidden items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] font-medium transition-colors hover:bg-secondary sm:inline-flex"
            >
              Import existing
            </button>
            <button
              onClick={() => createMut.mutate("New Project")}
              disabled={createMut.isPending}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {createMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              New project
            </button>
          </>
        }
      />

      <div className="flex items-center justify-between gap-4 border-b border-border px-7 py-3">
        <div className="relative w-[320px]">
          <Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects…"
            className="w-full rounded-full border border-border-soft bg-card py-2 pl-10 pr-4 text-[13px] placeholder:text-dim focus:border-foreground/25 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatus(f.key)}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors ${
                status === f.key
                  ? "border-border-soft bg-secondary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
              <span className="font-mono text-[11px] tabular-nums text-dim">
                {f.count}
              </span>
            </button>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border-soft px-3.5 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground">
                {SORT_LABELS[sort]}
                <ChevronDown className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <DropdownMenuItem key={key} onClick={() => setSort(key)}>
                  {SORT_LABELS[key]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-7">
        {projectsQuery.isLoading ? (
          <HairGrid cols={3}>
            {Array.from({ length: 9 }).map((_, i) => (
              <HairCell key={i} className="h-[148px] animate-pulse bg-card" />
            ))}
          </HairGrid>
        ) : projectsQuery.isError ? (
          <div className="rounded-2xl border border-crit/40 bg-crit/10 p-8 text-center text-sm text-crit">
            Failed to load projects. {(projectsQuery.error as Error)?.message}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border py-24 text-center">
            <p className="text-[14.5px]">
              {search || status !== "all"
                ? "No matching projects"
                : "No projects yet"}
            </p>
            <p className="mt-1.5 font-mono text-[11px] lowercase text-dim">
              {search || status !== "all"
                ? "try a different filter"
                : "bring a repo, or describe what you want to build"}
            </p>
            {!search && status === "all" && (
              <button
                onClick={() => createMut.mutate("New Project")}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Create your first project
              </button>
            )}
          </div>
        ) : (
          <HairGrid cols={3}>
            {visible.map((p) => (
              <ProjectCell
                key={p.id}
                project={p}
                tone={projectTone(p, health[p.id])}
                onOpen={() =>
                  navigate({
                    to: "/console/projects/$id",
                    params: { id: p.id },
                  })
                }
                onRename={() => setRenameTarget(p)}
                onDuplicate={() => duplicateMut.mutate(p.id)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </HairGrid>
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
      {renameTarget && (
        <RenameProjectDialog
          project={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRename={(name) => {
            renameMut.mutate({ id: renameTarget.id, name });
            setRenameTarget(null);
          }}
        />
      )}
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

/** Replaces window.prompt, which was the last browser-chrome control on a
 *  screen where everything else is ours. */
function RenameProjectDialog({
  project,
  onClose,
  onRename,
}: {
  project: ProjectSummary;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const submit = () => {
    const next = name.trim();
    if (next && next !== project.name) onRename(next);
    else onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-medium">
            Rename project
          </DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          className="w-full rounded-lg border border-border-soft bg-card px-3.5 py-2.5 text-[13.5px] focus:border-foreground/30 focus:outline-none"
        />
        <DialogFooter>
          <button
            onClick={onClose}
            className="rounded-full border border-border px-4 py-2 text-[13px] transition-colors hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Rename
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * No provider chips. The approved mockup shows a `github` `vercel` `supabase`
 * row on each cell, but ProjectSummary has no such field — getProjects reads
 * the `project_summary` Postgres view, so shipping them means altering a view
 * and its migration. That is backend work and it is recorded as a follow-up;
 * it is not faked from node_count here.
 */
function ProjectCell({
  project: p,
  tone,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: {
  project: ProjectSummary;
  tone: Tone;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <HairCell
      onClick={onOpen}
      className="group flex min-h-[148px] cursor-pointer flex-col"
    >
      <div className="flex items-center gap-2.5">
        <StateDot tone={tone} />
        <span className="truncate text-[14.5px] font-medium tracking-[-0.01em]">
          {p.name}
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[10.5px] lowercase text-muted-foreground">
          {statusLabel(p.status)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions for ${p.name}`}
              className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
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
              className="text-crit focus:text-crit"
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-auto pt-4 font-mono text-[10.5px] lowercase tabular-nums text-dim">
        {p.node_count} {NOUNS.service.toLowerCase()}s · {p.edge_count}{" "}
        {NOUNS.connection.toLowerCase()}s · {p.deploy_count} deploys
      </div>
      <div className="mt-2 font-mono text-[10.5px] lowercase text-dim">
        {p.last_deployed_at
          ? `deployed ${timeAgo(new Date(p.last_deployed_at).getTime())}`
          : "never deployed"}
      </div>
    </HairCell>
  );
}
