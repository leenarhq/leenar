import { useEffect, useRef, useState } from "react";
import { ChevronDown, GitBranch, Settings } from "lucide-react";
import type { WorkflowEnvironment } from "../../lib/api";

interface EnvSwitcherProps {
  environments: WorkflowEnvironment[];
  currentEnvId: string | null;
  onSwitch: (envId: string) => void;
  onManage: () => void;
  disabled?: boolean;
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

function flattenTree(
  nodes: TreeNode[],
  depth = 0,
): Array<{ env: WorkflowEnvironment; depth: number }> {
  return nodes.flatMap((n) => [
    { env: n.env, depth },
    ...flattenTree(n.children, depth + 1),
  ]);
}

export function EnvSwitcher({
  environments,
  currentEnvId,
  onSwitch,
  onManage,
  disabled,
}: EnvSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = environments.find((e) => e.id === currentEnvId);
  const flat = flattenTree(buildTree(environments));

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (environments.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] lowercase transition-colors ${
          open
            ? "bg-secondary border-border text-foreground"
            : "bg-[var(--hover)] border-border-soft text-muted-foreground hover:text-foreground hover:bg-[var(--hover)]"
        } disabled:opacity-30 disabled:cursor-not-allowed`}
      >
        <GitBranch size={10} />
        <span className="max-w-[72px] truncate">{current?.slug ?? "env"}</span>
        <ChevronDown
          size={9}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+6px)] min-w-[180px] border border-border rounded-xl shadow-2xl z-50 p-1"
          style={{
            animation: "dropIn 0.1s ease",
            background: "var(--popover)",
          }}
        >
          <div className="px-2 py-1 mb-0.5">
            <span className="text-[10px] lowercase text-muted-foreground">
              Environments
            </span>
          </div>

          {flat.map(({ env, depth }) => (
            <button
              key={env.id}
              onClick={() => {
                setOpen(false);
                if (env.id !== currentEnvId) onSwitch(env.id);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all ${
                env.id === currentEnvId
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
              style={{ paddingLeft: 8 + depth * 16 }}
            >
              {depth > 0 && (
                <span className="text-dim text-[11px] shrink-0">└</span>
              )}
              <span className="text-[13px] font-medium flex-1 truncate">
                {env.name}
              </span>
              <span className="text-[10px] font-mono text-dim shrink-0">
                {env.slug}
              </span>
              {env.is_default && (
                <span className="text-[9px] font-mono text-primary/60 shrink-0 lowercase">
                  prod
                </span>
              )}
            </button>
          ))}

          <div className="h-px bg-secondary my-1" />

          <button
            onClick={() => {
              setOpen(false);
              onManage();
            }}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            <Settings size={11} />
            Manage environments
          </button>
        </div>
      )}
    </div>
  );
}
