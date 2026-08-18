import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { motion } from "framer-motion";
import { Database as DatabaseIcon, ChevronDown } from "lucide-react";
import { useAuth } from "../context/auth";
import { useProjectDashboard } from "../hooks/useProjectDashboard";
import { TableList } from "../components/database/TableList";
import { SqlEditor } from "../components/database/SqlEditor";
import { PoliciesTab } from "../components/database/PoliciesTab";
import { DataTab } from "../components/database/DataTab";
import { ExtensionsTab } from "../components/database/ExtensionsTab";
import { DraftSeedEditor } from "../components/database/DraftSeedEditor";
import type { TableDef } from "../components/database/TableEditor";

export const Route = createFileRoute("/console/projects/$id/database")({
  validateSearch: (search: Record<string, unknown>): { node?: string } => {
    const node = typeof search.node === "string" ? search.node : undefined;
    return node !== undefined ? { node } : {};
  },
  component: DatabasePage,
});

type SupabaseNodeData = {
  label?: string;
  provider?: string;
  supabaseProjectRef?: string;
  tables?: TableDef[];
};

function nodeLabel(node: Node): string {
  const data = (node.data ?? {}) as SupabaseNodeData;
  return data.label ?? node.id;
}

function DatabasePage() {
  const { session } = useAuth();
  const { id } = Route.useParams();
  const { node: nodeIdParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { canvas, loading, refetch } = useProjectDashboard(id);

  const supabaseNodes = useMemo<Node[]>(() => {
    const nodes = canvas?.nodes ?? [];
    return nodes.filter(
      (n) => (n.data as SupabaseNodeData | undefined)?.provider === "supabase",
    );
  }, [canvas]);

  // Auto-select the only Supabase node when the picker isn't already set.
  useEffect(() => {
    if (nodeIdParam) return;
    if (supabaseNodes.length !== 1) return;
    navigate({
      search: (prev) => ({ ...prev, node: supabaseNodes[0].id }),
      replace: true,
    });
  }, [nodeIdParam, supabaseNodes, navigate]);

  const selectedNode = useMemo(
    () => supabaseNodes.find((n) => n.id === nodeIdParam) ?? null,
    [supabaseNodes, nodeIdParam],
  );

  const [tab, setTab] = useState<
    "tables" | "data" | "sql" | "policies" | "extensions"
  >("tables");
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!session || loading) {
    return <div className="flex-1" />;
  }

  // No Supabase nodes on this project's canvas at all.
  if (supabaseNodes.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-4 sm:p-6">
          {/* No <h1>: ProjectContextBar renders `project / Database` above. */}
          <div className="rounded-2xl border border-border py-24 text-center text-[13px] text-muted-foreground">
            <DatabaseIcon size={20} className="mx-auto mb-3 text-dim" />
            No Supabase service on this project yet.
            <div className="mt-3">
              <Link
                to="/console/projects/$id/canvas"
                params={{ id }}
                className="text-[12px] text-foreground underline underline-offset-2 hover:text-muted-foreground"
              >
                Add one on the canvas
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectNode = (nid: string) => {
    navigate({ search: (prev) => ({ ...prev, node: nid }) });
    setPickerOpen(false);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        {/* Header + node picker */}
        <div className="mb-5 flex flex-wrap items-center justify-end gap-2">
          {supabaseNodes.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-soft px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-secondary"
              >
                <DatabaseIcon size={12} className="text-muted-foreground" />
                {selectedNode ? nodeLabel(selectedNode) : "Select database"}
                <ChevronDown size={12} className="text-muted-foreground" />
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-10 mt-1 min-w-[180px] rounded-xl border border-border bg-popover py-1 shadow-[var(--raise-lg)]">
                  {supabaseNodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => selectNode(n.id)}
                      className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-secondary ${
                        n.id === selectedNode?.id
                          ? "text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {nodeLabel(n)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {!selectedNode ? (
          <div className="rounded-2xl border border-border py-24 text-center text-[13px] text-muted-foreground">
            Select a database above.
          </div>
        ) : !(selectedNode.data as SupabaseNodeData).supabaseProjectRef ? (
          <DraftSeedEditor
            key={selectedNode.id}
            projectId={id}
            nodeId={selectedNode.id}
            initialTables={(selectedNode.data as SupabaseNodeData).tables ?? []}
            onSaved={refetch}
          />
        ) : (
          <>
            {/* Tabs — horizontally scrollable so all 5 fit on narrow screens
                instead of wrapping/clipping. */}
            <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-border">
              {(
                [
                  { key: "tables", label: "Tables" },
                  { key: "data", label: "Data" },
                  { key: "sql", label: "SQL Editor" },
                  { key: "policies", label: "Policies" },
                  { key: "extensions", label: "Extensions" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-[13px] transition-colors ${
                    tab === t.key
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                  {tab === t.key && (
                    // One shared layoutId, so the underline slides between
                    // tabs instead of blinking out and in. 1px, not the
                    // shadcn default 2px — a hairline is the system's rule.
                    <motion.span
                      layoutId="db-tab-underline"
                      className="absolute inset-x-0 -bottom-px h-px bg-foreground"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 32,
                      }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {tab === "tables" ? (
              <div data-testid="tables-tab">
                <TableList projectId={id} nodeId={selectedNode.id} />
              </div>
            ) : tab === "data" ? (
              <div data-testid="data-tab">
                <DataTab projectId={id} nodeId={selectedNode.id} />
              </div>
            ) : tab === "sql" ? (
              <div data-testid="sql-editor-tab">
                <SqlEditor projectId={id} nodeId={selectedNode.id} />
              </div>
            ) : tab === "policies" ? (
              <div data-testid="policies-tab">
                <PoliciesTab projectId={id} nodeId={selectedNode.id} />
              </div>
            ) : (
              <div data-testid="extensions-tab">
                <ExtensionsTab projectId={id} nodeId={selectedNode.id} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
