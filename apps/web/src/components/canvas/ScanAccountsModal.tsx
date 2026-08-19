import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import {
  scanVercelProjects,
  scanSupabaseProjects,
  createWorkflowFromScan,
  getGitHubRepos,
  type VercelScannedProject,
  type SupabaseScannedProject,
  type ScanConnection,
  type GitHubRepo,
} from "../../lib/api";

interface ScanAccountsModalProps {
  session: Session;
  onClose: () => void;
}

export function ScanAccountsModal({
  session,
  onClose,
}: ScanAccountsModalProps) {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [vercelProjects, setVercelProjects] = useState<VercelScannedProject[]>(
    [],
  );
  const [supabaseProjects, setSupabaseProjects] = useState<
    SupabaseScannedProject[]
  >([]);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [selectedGithub, setSelectedGithub] = useState<Set<string>>(new Set());
  const [githubError, setGithubError] = useState<string | null>(null);
  const [vercelError, setVercelError] = useState<string | null>(null);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);

  const [selectedVercel, setSelectedVercel] = useState<Set<string>>(new Set());
  const [selectedSupabase, setSelectedSupabase] = useState<Set<string>>(
    new Set(),
  );
  const [enabledConns, setEnabledConns] = useState<Set<string>>(new Set());
  const [workflowName, setWorkflowName] = useState("My Stack");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([
      scanVercelProjects(session),
      scanSupabaseProjects(session),
      getGitHubRepos(session),
    ]).then(([vRes, sRes, gRes]) => {
      if (cancelled) return;
      if (vRes.status === "fulfilled") setVercelProjects(vRes.value);
      else
        setVercelError(
          vRes.reason?.message ?? "Failed to load Vercel projects",
        );
      if (sRes.status === "fulfilled") setSupabaseProjects(sRes.value);
      else
        setSupabaseError(
          sRes.reason?.message ?? "Failed to load Supabase projects",
        );
      if (gRes.status === "fulfilled") setGithubRepos(gRes.value);
      else
        setGithubError(gRes.reason?.message ?? "Failed to load GitHub repos");
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const toggleVercel = useCallback((id: string) => {
    setSelectedVercel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSupabase = useCallback((ref: string) => {
    setSelectedSupabase((prev) => {
      const next = new Set(prev);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }, []);

  const toggleGithub = useCallback((fullName: string) => {
    setSelectedGithub((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }, []);

  const connKey = (supaRef: string, vercelId: string) =>
    `${supaRef}→${vercelId}`;

  const toggleConn = useCallback((supaRef: string, vercelId: string) => {
    const k = connKey(supaRef, vercelId);
    setEnabledConns((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // Auto-enable connections when a new selection is made
  useEffect(() => {
    setEnabledConns((prev) => {
      const next = new Set(prev);
      selectedSupabase.forEach((ref) => {
        selectedVercel.forEach((vid) => {
          next.add(connKey(ref, vid));
        });
      });
      return next;
    });
  }, [selectedVercel, selectedSupabase]);

  const selectedVercelList = vercelProjects.filter((p) =>
    selectedVercel.has(p.id),
  );
  const selectedSupabaseList = supabaseProjects.filter((p) =>
    selectedSupabase.has(p.ref),
  );
  const selectedGithubList = githubRepos.filter((r) =>
    selectedGithub.has(r.full_name),
  );
  const showConnections =
    selectedVercelList.length > 0 && selectedSupabaseList.length > 0;

  const handleImport = async () => {
    if (
      selectedVercelList.length +
        selectedSupabaseList.length +
        selectedGithubList.length ===
      0
    ) {
      toast.error("Select at least one project");
      return;
    }
    setCreating(true);
    try {
      const connections: ScanConnection[] = [];
      if (showConnections) {
        selectedSupabaseList.forEach((sp) => {
          selectedVercelList.forEach((vp) => {
            if (enabledConns.has(connKey(sp.ref, vp.id))) {
              connections.push({
                fromService: "supabase",
                fromRef: sp.ref,
                toService: "vercel",
                toRef: vp.id,
              });
            }
          });
        });
      }
      const wf = await createWorkflowFromScan(
        workflowName,
        selectedVercelList,
        selectedSupabaseList,
        selectedGithubList,
        connections,
        session,
      );
      toast.success(`"${wf.name}" imported`);
      onClose();
      navigate({ to: "/console/projects/$id/canvas", params: { id: wf.id } });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCreating(false);
    }
  };

  const totalSelected =
    selectedVercelList.length +
    selectedSupabaseList.length +
    selectedGithubList.length;

  return (
    <motion.div
      className="absolute inset-0 z-50 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        className="relative z-10 flex max-h-[75vh] w-[480px] flex-col rounded-2xl border border-border-soft shadow-[var(--raise-lg)]"
        style={{ background: "var(--popover)" }}
        initial={{ scale: 0.95, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-soft">
          <div>
            <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
              Scan Accounts
            </h2>
            <p className="text-[13px] text-dim mt-0.5">
              Import existing Vercel & Supabase projects
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-dim hover:text-foreground hover:bg-secondary transition-all"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 rounded-full border-2 border-border border-t-foreground animate-spin" />
              <span className="ml-3 text-[14px] text-muted-foreground">
                Scanning accounts…
              </span>
            </div>
          ) : (
            <>
              {/* Vercel section */}
              <ProjectSection
                label="Vercel"
                color="var(--primary-foreground)"
                icon={<TriangleIcon />}
                projects={vercelProjects.map((p) => ({
                  id: p.id,
                  name: p.name,
                  sub:
                    p.link?.org && p.link?.repo
                      ? `${p.link.org}/${p.link.repo}`
                      : undefined,
                }))}
                selected={selectedVercel}
                onToggle={toggleVercel}
                error={vercelError}
              />

              {/* Supabase section */}
              <ProjectSection
                label="Supabase"
                color="var(--foreground)"
                icon={<DatabaseIcon />}
                projects={supabaseProjects.map((p) => ({
                  id: p.ref,
                  name: p.name,
                  sub: p.region,
                }))}
                selected={selectedSupabase}
                onToggle={toggleSupabase}
                error={supabaseError}
              />

              {/* GitHub section */}
              <ProjectSection
                label="GitHub"
                color="var(--primary-foreground)"
                icon={<GitHubIcon />}
                projects={githubRepos.map((r) => ({
                  id: r.full_name,
                  name: r.name,
                  sub: r.full_name,
                }))}
                selected={selectedGithub}
                onToggle={toggleGithub}
                error={githubError}
              />

              {/* Connections */}
              {showConnections && (
                <div>
                  <p className="text-[11px] font-mono lowercase text-dim mb-2">
                    Connections
                  </p>
                  <div className="space-y-1">
                    {selectedSupabaseList.map((sp) =>
                      selectedVercelList.map((vp) => {
                        const k = connKey(sp.ref, vp.id);
                        const on = enabledConns.has(k);
                        const autoDetected = vp.supabaseRef === sp.ref;
                        return (
                          <button
                            key={k}
                            onClick={() => toggleConn(sp.ref, vp.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--hover)] transition-colors text-left"
                          >
                            <div
                              // bg-primary, not Supabase's #3ecf8e: a ticked
                              // box is a selection, and a selection is not a
                              // provider. The tick inside is already
                              // --primary-foreground, which is defined against
                              // --primary and against nothing else — the pair
                              // only looked right by accident.
                              className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors ${on ? "bg-primary border-primary" : "border-border bg-transparent"}`}
                            >
                              {on && (
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 10 10"
                                  fill="none"
                                >
                                  <path
                                    d="M2 5l2.5 2.5L8 2"
                                    stroke="var(--primary-foreground)"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </div>
                            <span className="text-[13px] text-muted-foreground font-mono">
                              {sp.name}
                            </span>
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              className="text-dim flex-shrink-0"
                            >
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                            <span className="text-[13px] text-muted-foreground font-mono">
                              {vp.name}
                            </span>
                            {autoDetected && (
                              // "auto" is provenance — how this pairing was
                              // found — not a state and not a provider, so it
                              // takes no hue.
                              <span className="ml-auto flex-shrink-0 rounded border border-border-soft px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                                auto
                              </span>
                            )}
                          </button>
                        );
                      }),
                    )}
                  </div>
                </div>
              )}

              {/* Project name */}
              {totalSelected > 0 && (
                <div>
                  <p className="text-[11px] font-mono lowercase text-dim mb-2">
                    Project Name
                  </p>
                  <input
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    className="w-full bg-[var(--hover)] border border-border rounded-lg px-3 py-2 text-[14px] text-foreground placeholder:text-dim focus:outline-none focus:border-border transition-colors"
                    placeholder="My Project"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="px-5 py-4 border-t border-border-soft flex items-center justify-between gap-3">
            <span className="text-[13px] text-dim">
              {totalSelected > 0
                ? `${totalSelected} project${totalSelected !== 1 ? "s" : ""} selected`
                : "Select projects to import"}
            </span>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-[14px] text-muted-foreground hover:text-foreground hover:bg-[var(--hover)] transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={totalSelected === 0 || creating}
                className="px-4 py-1.5 rounded-lg text-[14px] font-medium bg-secondary text-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                {creating ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

interface ProjectSectionProps {
  label: string;
  color: string;
  icon: React.ReactNode;
  projects: Array<{ id: string; name: string; sub?: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  error: string | null;
}

function ProjectSection({
  label,
  color,
  icon,
  projects,
  selected,
  onToggle,
  error,
}: ProjectSectionProps) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color }} className="opacity-70">
          {icon}
        </span>
        <p className="text-[11px] font-mono lowercase text-dim">{label}</p>
        {projects.length > 0 && (
          <span className="text-[11px] font-mono text-dim">
            ({projects.length})
          </span>
        )}
      </div>
      {error ? (
        <p className="text-[13px] text-dim pl-1">
          {error.includes("No") ||
          error.includes("not found") ||
          error.includes("connection")
            ? `No ${label} account connected — add it in Integrations`
            : error}
        </p>
      ) : projects.length === 0 ? (
        <p className="text-[13px] text-dim pl-1">No projects found</p>
      ) : (
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {projects.map((p) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                onClick={() => onToggle(p.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--hover)] transition-colors text-left"
              >
                <div
                  className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors ${on ? "border-foreground/40 bg-secondary" : "border-border bg-transparent"}`}
                >
                  {on && (
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2 5l2.5 2.5L8 2"
                        stroke="var(--muted-foreground)"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] text-foreground truncate">
                    {p.name}
                  </p>
                  {p.sub && (
                    <p className="text-[12px] text-dim truncate">{p.sub}</p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TriangleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12 2 22 20 2 20" />
    </svg>
  );
}

function DatabaseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0018 0V5" />
      <path d="M3 12a9 3 0 0018 0" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}
