import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookmarkPlus,
  Clock,
  History,
  Loader2,
  Lock,
  Play,
  Save,
  Trash2,
  Unlock,
} from "lucide-react";
import { useAuth } from "../../context/auth";
import {
  createSnippet,
  deleteSnippet,
  listSnippets,
  runDatabaseQuery,
} from "../../lib/api";
import type { QueryResult, Snippet } from "../../lib/databaseTypes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "../ui/table";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "../ui/alert-dialog";

type SqlEditorProps = {
  projectId: string;
  nodeId: string;
};

type QueryMode = "read" | "write";

type HistoryEntry = {
  id: string;
  sql: string;
  mode: QueryMode;
  ranAt: number;
};

const MAX_HISTORY = 20;

// Client-side heuristic only — a UI convenience to warn before sending a
// likely-destructive write. Real safety (read-only wrapping, agent write
// gating) is enforced server-side (Tasks 2 & 6).
const DESTRUCTIVE_KEYWORD_RE = /\b(drop|truncate)\b/i;
const DELETE_WITHOUT_WHERE_RE = /\bdelete\b(?![\s\S]*\bwhere\b)/i;
const UPDATE_WITHOUT_WHERE_RE = /\bupdate\b(?![\s\S]*\bwhere\b)/i;

function isDestructive(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;
  return (
    DESTRUCTIVE_KEYWORD_RE.test(trimmed) ||
    DELETE_WITHOUT_WHERE_RE.test(trimmed) ||
    UPDATE_WITHOUT_WHERE_RE.test(trimmed)
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function SqlEditor({ projectId, nodeId }: SqlEditorProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [sql, setSql] = useState("");
  const [mode, setMode] = useState<QueryMode>("read");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastRun, setLastRun] = useState<{
    result: QueryResult;
    durationMs: number;
  } | null>(null);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [snippetName, setSnippetName] = useState("");
  const [pendingDeleteSnippet, setPendingDeleteSnippet] =
    useState<Snippet | null>(null);

  const snippetsQuery = useQuery({
    queryKey: ["db-snippets", projectId, nodeId],
    queryFn: () => listSnippets(session!, projectId, nodeId),
    enabled: !!session,
  });
  const snippets = snippetsQuery.data?.snippets ?? [];

  const createSnippetMutation = useMutation({
    mutationFn: () =>
      createSnippet(session!, projectId, nodeId, snippetName, sql),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["db-snippets", projectId, nodeId],
      });
      setSavingSnippet(false);
      setSnippetName("");
    },
  });

  const deleteSnippetMutation = useMutation({
    mutationFn: (snippetId: string) =>
      deleteSnippet(session!, projectId, nodeId, snippetId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["db-snippets", projectId, nodeId],
      });
      setPendingDeleteSnippet(null);
    },
  });

  const mutation = useMutation({
    mutationFn: (vars: { sql: string; mode: QueryMode }) =>
      runDatabaseQuery(session!, projectId, nodeId, vars.sql, vars.mode),
    onSuccess: (data, vars) => {
      setLastRun(data);
      setHistory((prev) => {
        const entry: HistoryEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sql: vars.sql,
          mode: vars.mode,
          ranAt: Date.now(),
        };
        return [entry, ...prev].slice(0, MAX_HISTORY);
      });
    },
  });

  const executeQuery = () => {
    if (!sql.trim() || !session) return;
    mutation.mutate({ sql, mode });
  };

  const handleRunClick = () => {
    if (!sql.trim()) return;
    if (mode === "write" && isDestructive(sql)) {
      setConfirmOpen(true);
      return;
    }
    executeQuery();
  };

  const handleConfirmedRun = () => {
    setConfirmOpen(false);
    executeQuery();
  };

  const loadFromHistory = (entry: HistoryEntry) => {
    setSql(entry.sql);
    setMode(entry.mode);
  };

  const loadFromSnippet = (snippet: Snippet) => {
    setSql(snippet.sql);
  };

  const openSaveSnippet = () => {
    if (!sql.trim()) return;
    createSnippetMutation.reset();
    setSnippetName("");
    setSavingSnippet(true);
  };

  const cancelSaveSnippet = () => {
    setSavingSnippet(false);
    setSnippetName("");
    createSnippetMutation.reset();
  };

  const confirmSaveSnippet = () => {
    if (!sql.trim() || !snippetName.trim()) return;
    createSnippetMutation.mutate();
  };

  const result = lastRun?.result;

  return (
    <div className="space-y-4">
      {/* Mode toggle + Run */}
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center rounded-md border border-border bg-secondary/20 p-0.5">
          <button
            onClick={() => setMode("read")}
            className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "read"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Lock size={11} />
            Read-only
          </button>
          <button
            onClick={() => setMode("write")}
            className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === "write"
                ? "bg-destructive/15 text-destructive"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Unlock size={11} />
            Write
          </button>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={openSaveSnippet}
            disabled={!sql.trim() || !session}
          >
            <BookmarkPlus size={13} />
            Save snippet
          </Button>
          <Button
            size="sm"
            onClick={handleRunClick}
            disabled={!sql.trim() || mutation.isPending || !session}
          >
            {mutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Play size={13} />
            )}
            Run
          </Button>
        </div>
      </div>

      {/* SQL input */}
      <Textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        placeholder="select * from ..."
        spellCheck={false}
        className="min-h-[160px] font-mono text-xs leading-relaxed"
      />

      {/* Save snippet inline form */}
      {savingSnippet && (
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Save snippet
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={snippetName}
              onChange={(e) => setSnippetName(e.target.value)}
              placeholder="Snippet name"
              autoFocus
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveSnippet();
                if (e.key === "Escape") cancelSaveSnippet();
              }}
            />
            <Button
              size="sm"
              onClick={confirmSaveSnippet}
              disabled={
                !sql.trim() ||
                !snippetName.trim() ||
                createSnippetMutation.isPending
              }
            >
              {createSnippetMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelSaveSnippet}>
              Cancel
            </Button>
          </div>
          {createSnippetMutation.isError && (
            <div className="mt-2 flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle size={13} className="shrink-0" />
              {createSnippetMutation.error instanceof Error
                ? createSnippetMutation.error.message
                : "Failed to save snippet."}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {mutation.isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Query failed."}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="rounded-md border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-[11px] text-muted-foreground">
              {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
              {result.truncated && " (showing first 1000 rows)"}
            </p>
            <p className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
              <Clock size={10} />
              {lastRun?.durationMs}ms
            </p>
          </div>

          {result.truncated && (
            <div className="border-b border-border bg-yellow-500/10 px-4 py-1.5 text-[11px] text-yellow-500">
              Showing first 1000 rows.
            </div>
          )}

          {result.columns.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Query returned no columns.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {result.columns.map((col) => (
                      <TableHead
                        key={col}
                        className="h-8 whitespace-nowrap text-[10px] uppercase tracking-wider"
                      >
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      {row.map((cell, j) => (
                        <TableCell
                          key={j}
                          className="py-1.5 whitespace-nowrap font-mono text-xs text-foreground"
                        >
                          {formatCell(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Saved snippets */}
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
          <BookmarkPlus size={12} className="text-muted-foreground" />
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Snippets
          </p>
        </div>
        {deleteSnippetMutation.isError && (
          <div className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
            <AlertCircle size={13} className="shrink-0" />
            {deleteSnippetMutation.error instanceof Error
              ? deleteSnippetMutation.error.message
              : "Failed to delete snippet."}
          </div>
        )}
        {snippetsQuery.isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" />
            Loading snippets…
          </div>
        ) : snippets.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            No saved snippets yet.
          </div>
        ) : (
          <ul className="max-h-[220px] overflow-auto divide-y divide-border">
            {snippets.map((snippet) => (
              <li
                key={snippet.id}
                className="flex items-center gap-2 px-4 py-2 hover:bg-secondary/20 transition-colors"
              >
                <button
                  onClick={() => loadFromSnippet(snippet)}
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="truncate text-xs font-medium text-foreground">
                    {snippet.name}
                  </span>
                  <span className="w-full truncate font-mono text-[11px] text-muted-foreground">
                    {snippet.sql}
                  </span>
                </button>
                <button
                  onClick={() => setPendingDeleteSnippet(snippet)}
                  className="shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive transition-colors"
                  aria-label={`Delete snippet ${snippet.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Session-only history */}
      {history.length > 0 && (
        <div className="rounded-md border border-border bg-card">
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2">
            <History size={12} className="text-muted-foreground" />
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              History
            </p>
          </div>
          <ul className="max-h-[220px] overflow-auto divide-y divide-border">
            {history.map((entry) => (
              <li key={entry.id}>
                <button
                  onClick={() => loadFromHistory(entry)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-secondary/20 transition-colors"
                >
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      entry.mode === "write"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {entry.mode}
                  </span>
                  <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
                    {entry.sql}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Destructive confirm dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run destructive query?</AlertDialogTitle>
            <AlertDialogDescription>
              This statement looks destructive (DROP/TRUNCATE, or a
              DELETE/UPDATE without a WHERE clause) and is running in write
              mode. This action cannot be undone. Are you sure you want to
              proceed?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmedRun}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Run anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Snippet delete confirm dialog */}
      <AlertDialog
        open={pendingDeleteSnippet !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteSnippet(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete snippet?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteSnippet &&
                `Delete "${pendingDeleteSnippet.name}"? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                pendingDeleteSnippet &&
                deleteSnippetMutation.mutate(pendingDeleteSnippet.id)
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
