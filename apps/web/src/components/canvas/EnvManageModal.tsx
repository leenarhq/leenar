import { useState } from "react";
import {
  X,
  Plus,
  Trash2,
  Check,
  Pencil,
  ArrowUpToLine,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import type { Session } from "@supabase/supabase-js";
import type { WorkflowEnvironment } from "../../lib/api";
import {
  createEnvironment,
  deleteEnvironmentApi,
  renameEnvironment,
  promoteEnvironment,
  branchEnvironment,
} from "../../lib/api";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

interface EnvManageModalProps {
  workflowId: string;
  environments: WorkflowEnvironment[];
  currentEnvId: string | null;
  session: Session;
  onClose: () => void;
  onEnvsChange: (envs: WorkflowEnvironment[]) => void;
  onSwitchEnv: (envId: string) => void;
}

interface TreeNode {
  env: WorkflowEnvironment;
  children: TreeNode[];
}

function buildTree(envs: WorkflowEnvironment[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const env of envs) map.set(env.id, { env, children: [] });
  const roots: TreeNode[] = [];
  for (const env of envs) {
    const node = map.get(env.id)!;
    if (env.parent_id && map.has(env.parent_id)) {
      map.get(env.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function EnvManageModal({
  workflowId,
  environments,
  currentEnvId,
  session,
  onClose,
  onEnvsChange,
  onSwitchEnv,
}: EnvManageModalProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState("");
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promoteConfirmId, setPromoteConfirmId] = useState<string | null>(null);
  const [branchingFromId, setBranchingFromId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [branchSlug, setBranchSlug] = useState("");
  const [branchSlugManual, setBranchSlugManual] = useState(false);
  const [branching, setBranching] = useState(false);
  // Top-level create
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [creating, setCreating] = useState(false);

  const tree = buildTree(environments);

  const handleRename = async (envId: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const updated = await renameEnvironment(workflowId, envId, name, session);
      onEnvsChange(environments.map((e) => (e.id === envId ? updated : e)));
      setRenamingId(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleDelete = async (env: WorkflowEnvironment) => {
    if (env.is_default) return;
    setDeletingId(env.id);
    try {
      await deleteEnvironmentApi(workflowId, env.id, session);
      const updated = environments.filter((e) => e.id !== env.id);
      onEnvsChange(updated);
      if (currentEnvId === env.id) {
        const fallback = updated.find((e) => e.is_default) ?? updated[0];
        if (fallback) onSwitchEnv(fallback.id);
      }
      toast.success(`"${env.name}" deleted`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  const handlePromote = async (env: WorkflowEnvironment) => {
    setPromotingId(env.id);
    setPromoteConfirmId(null);
    try {
      const result = await promoteEnvironment(workflowId, env.id, session);
      toast.success(
        result.copied > 0
          ? `Config promoted from "${env.name}" → Production. Switch to Production and deploy.`
          : `Nothing to promote from "${env.name}".`,
        { duration: 6000 },
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPromotingId(null);
    }
  };

  const handleBranch = async (parentEnv: WorkflowEnvironment) => {
    const name = branchName.trim();
    const slug = branchSlug.trim().toLowerCase();
    if (!name) return toast.error("Name is required");
    if (!SLUG_RE.test(slug)) return toast.error("Invalid slug");
    if (environments.some((e) => e.slug === slug))
      return toast.error(`Slug "${slug}" already exists`);
    setBranching(true);
    try {
      const created = await branchEnvironment(
        workflowId,
        parentEnv.id,
        name,
        slug,
        session,
      );
      onEnvsChange([...environments, created]);
      setBranchingFromId(null);
      setBranchName("");
      setBranchSlug("");
      setBranchSlugManual(false);
      toast.success(`"${name}" branched from "${parentEnv.name}"`);
      onSwitchEnv(created.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBranching(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    const slug = newSlug.trim().toLowerCase();
    if (!name) return toast.error("Name is required");
    if (!SLUG_RE.test(slug)) return toast.error("Invalid slug");
    if (environments.some((e) => e.slug === slug))
      return toast.error(`Slug "${slug}" already exists`);
    setCreating(true);
    try {
      const created = await createEnvironment(workflowId, name, slug, session);
      onEnvsChange([...environments, created]);
      setNewName("");
      setNewSlug("");
      setSlugManuallyEdited(false);
      toast.success(`Environment "${name}" created`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const renderNode = (
    node: TreeNode,
    depth: number,
    isLastSibling: boolean,
    parentLines: boolean[],
  ) => {
    const { env } = node;
    const isActive = env.id === currentEnvId;
    const isBranchingHere = branchingFromId === env.id;

    return (
      <div key={env.id}>
        {/* Row */}
        <div className="flex items-start gap-0">
          {/* Tree lines */}
          {depth > 0 && (
            <div className="flex shrink-0" style={{ width: depth * 20 }}>
              {parentLines.map((hasLine, i) => (
                <div key={i} className="shrink-0" style={{ width: 20 }}>
                  {hasLine && (
                    <div className="w-px bg-border mx-auto h-full min-h-[36px]" />
                  )}
                </div>
              ))}
              <div className="shrink-0 relative" style={{ width: 20 }}>
                <div className="absolute left-1/2 top-0 w-px bg-border h-[18px] -translate-x-1/2" />
                {!isLastSibling && (
                  <div className="absolute left-1/2 top-[18px] w-px bg-border bottom-0 -translate-x-1/2" />
                )}
                <div className="absolute left-1/2 top-[18px] w-[10px] h-px bg-border" />
              </div>
            </div>
          )}

          {/* Env card */}
          <div
            className={`flex-1 flex items-center gap-2 px-2.5 py-2 rounded-xl border mb-1 transition-all ${
              isActive
                ? "border-primary/30 bg-primary/[0.06]"
                : "border-border-soft bg-[var(--hover)]"
            }`}
          >
            <div className="flex-1 min-w-0">
              {renamingId === env.id ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(env.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="flex-1 bg-secondary border border-border rounded-md px-2 py-0.5 text-[13px] text-foreground outline-none focus:border-primary/40"
                  />
                  <button
                    onClick={() => handleRename(env.id)}
                    className="p-1 rounded text-foreground hover:bg-[var(--hover)]"
                  >
                    <Check size={12} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[13px] font-medium text-foreground truncate">
                    {env.name}
                  </span>
                  <span className="text-[9px] font-mono text-dim">
                    {env.slug}
                  </span>
                  {env.is_default && (
                    <span className="text-[8px] font-mono text-primary/50 lowercase">
                      production
                    </span>
                  )}
                  {isActive && (
                    <span className="text-[8px] font-mono text-ok lowercase">
                      active
                    </span>
                  )}
                </div>
              )}
            </div>

            {renamingId !== env.id && (
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Branch from this env */}
                <button
                  onClick={() => {
                    setBranchingFromId(isBranchingHere ? null : env.id);
                    setBranchName("");
                    setBranchSlug("");
                    setBranchSlugManual(false);
                  }}
                  title="Branch from this environment"
                  className={`p-1.5 rounded-md transition-all ${
                    isBranchingHere
                      ? "text-foreground bg-secondary"
                      : "text-dim hover:text-foreground hover:bg-[var(--hover)]"
                  }`}
                >
                  <GitBranch size={11} />
                </button>

                {!env.is_default && (
                  <>
                    {/* Promote to parent / production */}
                    {promoteConfirmId === env.id ? (
                      <button
                        onClick={() => handlePromote(env)}
                        disabled={promotingId === env.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-warn border border-warn/30 bg-warn/10 hover:bg-warn/15 transition-all disabled:opacity-50"
                      >
                        {promotingId === env.id ? "…" : "Confirm"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setPromoteConfirmId(env.id)}
                        title="Promote config to Production"
                        className="p-1.5 rounded-md text-dim hover:text-warn hover:bg-warn/10 transition-all"
                      >
                        <ArrowUpToLine size={11} />
                      </button>
                    )}

                    {/* Rename */}
                    <button
                      onClick={() => {
                        setRenamingId(env.id);
                        setRenameValue(env.name);
                        setPromoteConfirmId(null);
                        setBranchingFromId(null);
                      }}
                      className="p-1.5 rounded-md text-dim hover:text-foreground hover:bg-secondary transition-all"
                    >
                      <Pencil size={11} />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => {
                        setDeleteConfirmId(env.id);
                        setDeleteConfirmValue("");
                        setPromoteConfirmId(null);
                        setBranchingFromId(null);
                        setRenamingId(null);
                      }}
                      disabled={deletingId === env.id}
                      className="p-1.5 rounded-md text-dim hover:text-crit hover:bg-crit/10 transition-all disabled:opacity-40"
                    >
                      <Trash2 size={11} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Inline delete confirmation */}
        {deleteConfirmId === env.id && (
          <div
            className="mb-2 pl-3 border-l border-crit/30"
            style={{ marginLeft: (depth + 1) * 20 }}
          >
            <p className="text-[10px] text-crit font-mono lowercase mb-1.5">
              Type <span className="text-crit">{env.name}</span> to confirm
              deletion
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                placeholder={env.name}
                value={deleteConfirmValue}
                onChange={(e) => setDeleteConfirmValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setDeleteConfirmId(null);
                    setDeleteConfirmValue("");
                  }
                  if (e.key === "Enter" && deleteConfirmValue === env.name)
                    handleDelete(env);
                }}
                className="flex-1 bg-crit/5 border border-crit/30 rounded-lg px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-dim outline-none focus:border-crit/40 transition-all"
              />
              <button
                onClick={() => handleDelete(env)}
                disabled={
                  deleteConfirmValue !== env.name || deletingId === env.id
                }
                className="px-3 py-1.5 rounded-lg bg-crit/15 border border-crit/30 text-crit text-[11px] font-semibold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-crit/15 transition-all"
              >
                {deletingId === env.id ? "Deleting…" : "Delete"}
              </button>
              <button
                onClick={() => {
                  setDeleteConfirmId(null);
                  setDeleteConfirmValue("");
                }}
                className="px-3 py-1.5 rounded-lg text-dim text-[11px] hover:text-muted-foreground transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Inline branch form */}
        {isBranchingHere && (
          <div
            className="mb-2 ml-5 pl-3 border-l border-primary/20"
            style={{ marginLeft: (depth + 1) * 20 }}
          >
            <p className="text-[10px] text-primary/50 font-mono lowercase mb-1.5">
              Branch from {env.name}
            </p>
            <div className="flex gap-2">
              <input
                autoFocus
                placeholder="Name (e.g. Hotfix)"
                value={branchName}
                onChange={(e) => {
                  setBranchName(e.target.value);
                  if (!branchSlugManual) setBranchSlug(slugify(e.target.value));
                }}
                onKeyDown={(e) => e.key === "Enter" && handleBranch(env)}
                className="flex-1 bg-[var(--hover)] border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-dim outline-none focus:border-primary/30 transition-all"
              />
              <input
                placeholder="slug"
                value={branchSlug}
                onChange={(e) => {
                  setBranchSlugManual(true);
                  setBranchSlug(
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                  );
                }}
                onKeyDown={(e) => e.key === "Enter" && handleBranch(env)}
                className="w-20 bg-[var(--hover)] border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-dim outline-none focus:border-primary/30 transition-all font-mono"
              />
              <button
                onClick={() => handleBranch(env)}
                disabled={branching || !branchName.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/25 text-primary text-[12px] font-medium hover:bg-primary/15 transition-all disabled:opacity-40"
              >
                {branching ? "…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Children */}
        {node.children.map((child, i) =>
          renderNode(child, depth + 1, i === node.children.length - 1, [
            ...parentLines,
            !isLastSibling,
          ]),
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-2xl border border-border-soft shadow-[var(--raise-lg)]"
        style={{ background: "var(--popover)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
            Environments
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-dim hover:text-foreground hover:bg-secondary transition-all"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 max-h-[420px]">
          {tree.map((node, i) =>
            renderNode(node, 0, i === tree.length - 1, []),
          )}
        </div>

        {/* Add top-level env */}
        <div className="px-4 pb-4 pt-2 border-t border-border-soft">
          <p className="text-[10px] text-dim mb-2 font-mono lowercase">
            New environment
          </p>
          <div className="flex items-center gap-2">
            <input
              placeholder="Name (e.g. Staging)"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!slugManuallyEdited) setNewSlug(slugify(e.target.value));
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="flex-1 bg-[var(--hover)] border border-border rounded-lg px-3 py-1.5 text-[13px] text-foreground placeholder:text-dim outline-none focus:border-primary/30 transition-all"
            />
            <input
              placeholder="slug"
              value={newSlug}
              onChange={(e) => {
                setSlugManuallyEdited(true);
                setNewSlug(
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                );
              }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              className="w-24 bg-[var(--hover)] border border-border rounded-lg px-3 py-1.5 text-[13px] text-foreground placeholder:text-dim outline-none focus:border-primary/30 transition-all font-mono"
            />
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="p-2 rounded-lg border border-border text-foreground hover:bg-[var(--hover)] transition-all disabled:opacity-40"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
