import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "../../context/auth";
import { getDatabaseSchema, mutateDatabaseSchema } from "../../lib/api";
import type {
  LivePolicy,
  LiveTable,
  SchemaMutation,
} from "../../lib/databaseTypes";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../ui/select";
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

type PoliciesTabProps = {
  projectId: string;
  nodeId: string;
};

type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

type PresetKey = "owner" | "publicRead" | "authenticatedOnly" | "custom";

type PolicyDraft = {
  name: string;
  command: PolicyCommand;
  roles: string;
  using: string;
  withCheck: string;
};

const EMPTY_DRAFT: PolicyDraft = {
  name: "",
  command: "ALL",
  roles: "",
  using: "",
  withCheck: "",
};

const PRESETS: Record<
  Exclude<PresetKey, "custom">,
  Omit<PolicyDraft, "name">
> = {
  owner: {
    command: "ALL",
    roles: "authenticated",
    using: "auth.uid() = user_id",
    withCheck: "auth.uid() = user_id",
  },
  publicRead: {
    command: "SELECT",
    roles: "anon, authenticated",
    using: "true",
    withCheck: "",
  },
  authenticatedOnly: {
    command: "ALL",
    roles: "authenticated",
    using: "auth.role() = 'authenticated'",
    withCheck: "",
  },
};

const PRESET_OPTIONS: { key: PresetKey; label: string }[] = [
  { key: "owner", label: "Owner-based" },
  { key: "publicRead", label: "Public read" },
  { key: "authenticatedOnly", label: "Authenticated only" },
  { key: "custom", label: "Custom / raw" },
];

const POLICY_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

type PendingDrop = { table: string; name: string };

export function PoliciesTab({ projectId, nodeId }: PoliciesTabProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [addingTable, setAddingTable] = useState<string | null>(null);
  const [preset, setPreset] = useState<PresetKey>("owner");
  const [draft, setDraft] = useState<PolicyDraft>(EMPTY_DRAFT);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  const schemaQuery = useQuery({
    queryKey: ["db-schema", projectId, nodeId],
    queryFn: () => getDatabaseSchema(session!, projectId, nodeId),
    enabled: !!session,
  });

  const runMutation = useMutation({
    mutationFn: (m: SchemaMutation) =>
      mutateDatabaseSchema(session!, projectId, nodeId, m),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["db-schema", projectId, nodeId],
      });
    },
  });

  const tables = schemaQuery.data?.schema.tables ?? [];

  const openAddForm = (tableName: string) => {
    setAddingTable(tableName);
    setPreset("owner");
    setDraft({ ...EMPTY_DRAFT, ...PRESETS.owner });
    runMutation.reset();
  };

  const cancelAddForm = () => {
    setAddingTable(null);
    setDraft(EMPTY_DRAFT);
  };

  const applyPreset = (key: PresetKey) => {
    setPreset(key);
    setDraft((prev) => ({
      ...prev,
      ...(key === "custom" ? EMPTY_DRAFT : PRESETS[key]),
      name: prev.name,
    }));
  };

  const nameValid = POLICY_NAME_RE.test(draft.name.trim());
  const canSubmit = draft.name.trim().length > 0 && nameValid;

  const submitCreate = () => {
    if (!addingTable || !canSubmit) return;
    const roles = draft.roles
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    runMutation.mutate(
      {
        kind: "createPolicy",
        table: addingTable,
        name: draft.name.trim(),
        command: draft.command,
        ...(roles.length > 0 ? { roles } : {}),
        ...(draft.using.trim() ? { using: draft.using.trim() } : {}),
        ...(draft.withCheck.trim()
          ? { withCheck: draft.withCheck.trim() }
          : {}),
      },
      {
        onSuccess: () => {
          setAddingTable(null);
          setDraft(EMPTY_DRAFT);
        },
      },
    );
  };

  const requestDrop = (table: string, name: string) => {
    setPendingDrop({ table, name });
  };

  const confirmDrop = () => {
    if (!pendingDrop) return;
    runMutation.mutate({
      kind: "dropPolicy",
      table: pendingDrop.table,
      name: pendingDrop.name,
    });
    setPendingDrop(null);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-foreground/70">
          {schemaQuery.isSuccess
            ? `${tables.length} table${tables.length === 1 ? "" : "s"}`
            : ""}
        </p>
        <button
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: ["db-schema", projectId, nodeId],
            })
          }
          disabled={schemaQuery.isFetching}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
        >
          {schemaQuery.isFetching ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ShieldCheck size={12} />
          )}
          Refresh
        </button>
      </div>

      {/* Mutation error banner */}
      {runMutation.isError && (
        <div className="mb-3 flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          {runMutation.error instanceof Error
            ? runMutation.error.message
            : "Mutation failed."}
        </div>
      )}

      {/* Loading skeleton */}
      {schemaQuery.isLoading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-border bg-secondary"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {schemaQuery.isError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={14} className="shrink-0" />
          Failed to load schema
          {schemaQuery.error instanceof Error
            ? `: ${schemaQuery.error.message}`
            : "."}
        </div>
      )}

      {/* Empty state */}
      {schemaQuery.isSuccess && tables.length === 0 && (
        <div className="rounded-xl border border-border py-24 text-center text-sm text-muted-foreground">
          No tables found in this database.
        </div>
      )}

      {/* Policies grouped by table */}
      {schemaQuery.isSuccess && tables.length > 0 && (
        <div className="space-y-2">
          {tables.map((table: LiveTable) => (
            <div
              key={table.name}
              className="rounded-xl border border-border bg-card overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="font-mono text-xs text-foreground">
                  {table.name}
                </span>
                <button
                  onClick={() => openAddForm(table.name)}
                  disabled={runMutation.isPending}
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <Plus size={11} />
                  Add policy
                </button>
              </div>

              <div className="px-4 py-3">
                {table.policies.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No policies — table is locked (deny-all when RLS enabled).
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {table.policies.map((policy: LivePolicy) => (
                      <li
                        key={policy.name}
                        className="rounded-xl border border-border bg-secondary px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs text-foreground truncate">
                              {policy.name}
                            </span>
                            <span className="inline-flex rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] lowercase text-muted-foreground">
                              {policy.command}
                            </span>
                            {/* Neither kind is better than the other, so
                                neither gets a tone — permissive/restrictive
                                is a category (spec D3). */}
                            <span className="inline-flex rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] lowercase text-muted-foreground">
                              {policy.permissive ? "permissive" : "restrictive"}
                            </span>
                          </div>
                          <button
                            onClick={() => requestDrop(table.name, policy.name)}
                            disabled={runMutation.isPending}
                            className="shrink-0 inline-flex items-center gap-1 text-[11px] text-destructive/80 hover:text-destructive transition-colors disabled:opacity-40"
                          >
                            <Trash2 size={11} />
                            Drop
                          </button>
                        </div>
                        <div className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
                          <div>
                            roles:{" "}
                            <span className="font-mono">
                              {policy.roles.length > 0
                                ? policy.roles.join(", ")
                                : "public"}
                            </span>
                          </div>
                          {policy.using && (
                            <div>
                              using:{" "}
                              <span className="font-mono">{policy.using}</span>
                            </div>
                          )}
                          {policy.withCheck && (
                            <div>
                              with check:{" "}
                              <span className="font-mono">
                                {policy.withCheck}
                              </span>
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Create form */}
                {addingTable === table.name && (
                  <div className="mt-3 space-y-2 rounded-xl border border-border bg-secondary p-3">
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_OPTIONS.map((opt) => (
                        <button
                          key={opt.key}
                          onClick={() => applyPreset(opt.key)}
                          disabled={runMutation.isPending}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                            preset === opt.key
                              ? "border-foreground/40 bg-secondary text-foreground"
                              : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        value={draft.name}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        placeholder="policy_name"
                        disabled={runMutation.isPending}
                        className="h-7 w-48 font-mono text-xs"
                      />
                      <Select
                        value={draft.command}
                        onValueChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            command: v as PolicyCommand,
                          }))
                        }
                        disabled={runMutation.isPending}
                      >
                        <SelectTrigger className="h-7 w-28 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(
                            [
                              "ALL",
                              "SELECT",
                              "INSERT",
                              "UPDATE",
                              "DELETE",
                            ] as const
                          ).map((c) => (
                            <SelectItem key={c} value={c} className="text-xs">
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={draft.roles}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            roles: e.target.value,
                          }))
                        }
                        placeholder="roles (comma-separated, blank = public)"
                        disabled={runMutation.isPending}
                        className="h-7 w-64 font-mono text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      <Textarea
                        value={draft.using}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            using: e.target.value,
                          }))
                        }
                        placeholder="USING expression (optional)"
                        disabled={runMutation.isPending}
                        className="min-h-[52px] font-mono text-xs"
                      />
                      <Textarea
                        value={draft.withCheck}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            withCheck: e.target.value,
                          }))
                        }
                        placeholder="WITH CHECK expression (optional)"
                        disabled={runMutation.isPending}
                        className="min-h-[52px] font-mono text-xs"
                      />
                    </div>

                    {!nameValid && draft.name.trim().length > 0 && (
                      <p className="text-[10px] text-destructive">
                        Policy name must start with a letter or underscore and
                        contain only letters, digits, underscores.
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={cancelAddForm}
                        disabled={runMutation.isPending}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={submitCreate}
                        disabled={runMutation.isPending || !canSubmit}
                      >
                        {runMutation.isPending && (
                          <Loader2 size={12} className="animate-spin" />
                        )}
                        Create
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Destructive confirm dialog */}
      <AlertDialog
        open={pendingDrop !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDrop(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm destructive change</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDrop &&
                `Drop policy "${pendingDrop.name}" on "${pendingDrop.table}"? This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDrop}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
