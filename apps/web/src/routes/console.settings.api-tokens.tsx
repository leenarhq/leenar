import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2, Copy, Loader2, Check } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import {
  Rows,
  Row,
  RowHead,
  Mono,
  Dim,
  ROW_HEAD_WIDE_ONLY,
} from "../components/console/Rows";
import { StateTag } from "../components/console/StateTag";
import { INPUT, PILL } from "../components/console/Field";
import { useAuth } from "../context/auth";

/* Kept literal so Tailwind's scanner sees it, and declared once because the
   header and the rows have to agree — they were two copies of this string. */
const COLS = "sm:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto]";
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
      <div className="flex-1 p-5 sm:p-8">
        <SettingsHeader subtitle="Create tokens that grant access to the Leenar API on behalf of this account." />

        <div className="mt-6 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Token name (e.g. CI pipeline)"
            className={`flex-1 ${INPUT}`}
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "read" | "write")}
            className={INPUT}
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
            className={PILL}
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
          <div className="mt-4 rounded-xl border border-ok/30 p-4">
            <p className="text-[12px] text-ok">
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
                className="inline-flex items-center gap-1 rounded-full border border-border-soft px-2.5 py-1.5 text-[12px] transition-colors hover:bg-secondary"
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

        <div className="mt-6">
          <Rows>
            <RowHead className={ROW_HEAD_WIDE_ONLY}>
              <div className={`grid w-full gap-4 ${COLS}`}>
                <div>name</div>
                <div>scope</div>
                <div>prefix</div>
                <div>last used</div>
                <div />
              </div>
            </RowHead>
            {keysQuery.isLoading ? (
              <div className="px-4 py-12 text-center text-[13px] text-muted-foreground">
                Loading…
              </div>
            ) : keys.length === 0 ? (
              <div className="px-4 py-16 text-center text-[13px] text-muted-foreground">
                No API tokens yet.
              </div>
            ) : (
              keys.map((k) => (
                <Row key={k.id}>
                  <div
                    className={`grid w-full grid-cols-1 gap-1.5 sm:items-center sm:gap-4 ${COLS}`}
                  >
                    <div className="truncate">{k.name}</div>
                    {/* `sm:contents` dissolves this wrapper back into the grid
                        above the breakpoint, so the three secondary values are
                        real columns there and one wrapped line here. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:contents">
                      {/* A scope is a category, not a state — no hue (spec D3). */}
                      <div>
                        <StateTag
                          tone="idle"
                          label={k.scope === "write" ? "write" : "read"}
                        />
                      </div>
                      <Mono>{k.key_prefix}…</Mono>
                      <Dim>
                        {k.last_used_at
                          ? `used ${timeAgo(new Date(k.last_used_at).getTime())}`
                          : "never used"}
                      </Dim>
                    </div>
                    <button
                      onClick={() =>
                        window.confirm(`Revoke "${k.name}"?`) &&
                        revokeMut.mutate(k.id)
                      }
                      aria-label={`Revoke ${k.name}`}
                      className="justify-self-end rounded-full p-1.5 text-muted-foreground transition-colors hover:text-crit"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </Row>
              ))
            )}
          </Rows>
        </div>
      </div>
    </SettingsShell>
  );
}
