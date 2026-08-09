import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Copy, Loader2, Check } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import { useAuth } from "../context/auth";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  type ApiKeyCreated,
} from "../lib/api";
import { timeAgo } from "../lib/utils";

export const Route = createFileRoute("/console/settings/api-tokens")({
  component: ApiTokensPage,
  head: () => ({ meta: [{ title: "API Tokens — Leenar Console" }] }),
});

function ApiTokensPage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);

  const keysQuery = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => (session ? listApiKeys(session) : Promise.resolve([])),
    enabled: !!session,
  });

  const createMut = useMutation({
    mutationFn: (vars: { name: string; scope: "read" | "write" }) =>
      createApiKey(vars.name, vars.scope, session!),
    onSuccess: (key) => {
      setCreated(key);
      setNewName("");
      setScope("read");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeApiKey(id, session!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const keys = keysQuery.data ?? [];

  return (
    <SettingsShell title="API Tokens">
      <div className="flex-1 p-8">
        <SettingsHeader
          title="API tokens"
          subtitle="Leenar API'ya bu hesap adına erişim sağlamak için token oluşturun."
        />

        <div className="mt-6 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Token name (e.g. CI pipeline)"
            className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "read" | "write")}
            className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="read">Read-only</option>
            <option value="write">Read &amp; write</option>
          </select>
          <button
            onClick={() =>
              newName.trim() &&
              createMut.mutate({ name: newName.trim(), scope })
            }
            disabled={createMut.isPending || !newName.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
          >
            {createMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}{" "}
            Create token
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Read &amp; write tokens can create and deploy workflows via the MCP
          server — keep them secret. Read-only tokens can only list and inspect.
        </p>

        {created && (
          <div className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-xs text-emerald-400">
              Copy this token now — it won't be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
                {created.key}
              </code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(created.key);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-secondary"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}{" "}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-6 rounded-md border border-border">
          <div className="grid grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] gap-4 border-b border-border bg-secondary/20 px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Name</div>
            <div>Scope</div>
            <div>Prefix</div>
            <div>Last used</div>
            <div></div>
          </div>
          {keysQuery.isLoading ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : keys.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No API tokens yet.
            </div>
          ) : (
            keys.map((k) => (
              <div
                key={k.id}
                className="grid grid-cols-[2fr_1fr_1.5fr_1.5fr_auto] items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0"
              >
                <div className="truncate">{k.name}</div>
                <div>
                  <span
                    className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                      k.scope === "write"
                        ? "bg-amber-500/15 text-amber-500"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {k.scope === "write" ? "write" : "read"}
                  </span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  {k.key_prefix}…
                </div>
                <div className="text-xs text-muted-foreground">
                  {k.last_used_at
                    ? timeAgo(new Date(k.last_used_at).getTime())
                    : "never"}
                </div>
                <button
                  onClick={() =>
                    window.confirm(`Revoke "${k.name}"?`) &&
                    revokeMut.mutate(k.id)
                  }
                  className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </SettingsShell>
  );
}
