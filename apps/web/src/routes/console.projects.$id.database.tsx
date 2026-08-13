import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
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
          <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Database
          </h1>
          <div className="mt-5 rounded-md border border-dashed border-border py-24 text-center text-sm text-muted-foreground">
            <DatabaseIcon
              size={20}
              className="mx-auto mb-3 text-muted-foreground/60"
            />
            No Supabase service on this project yet.
            <div className="mt-3">
              <Link
                to="/console/projects/$id/canvas"
                params={{ id }}
                className="text-xs text-foreground underline underline-offset-2 hover:text-foreground/80"
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
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Database
          </h1>

          {supabaseNodes.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setPickerOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground hover:bg-secondary transition-colors"
              >
                <DatabaseIcon size={12} className="text-muted-foreground" />
                {selectedNode ? nodeLabel(selectedNode) : "Select database"}
                <ChevronDown size={12} className="text-muted-foreground" />
              </button>
              {pickerOpen && (
                <div className="absolute right-0 z-10 mt-1 min-w-[180px] rounded-md border border-border bg-card py-1 shadow-lg">
                  {supabaseNodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => selectNode(n.id)}
                      className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-secondary/60 ${
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
          <div className="rounded-md border border-dashed border-border py-24 text-center text-sm text-muted-foreground">
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
                  className={`shrink-0 whitespace-nowrap px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                    tab === t.key
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
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
