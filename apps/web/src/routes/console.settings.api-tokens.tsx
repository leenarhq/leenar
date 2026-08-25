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
import { isCloud } from "../lib/cloud";

/* Kept literal so Tailwind's scanner sees it, and declared once because the
   header and the rows have to agree — they were two copies of this string. */
const COLS = "sm:grid-cols-[2fr_1fr_1.5fr_1.5fr_auto]";

/* Shared by the two copy buttons in the one-time reveal, for the same reason
   COLS is shared: they were about to be two copies of one string. */
const COPY_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-full border border-border-soft px-2.5 py-1.5 text-[12px] transition-colors hover:bg-secondary";

/**
 * The `claude mcp add` line for this key, ready to paste.
 *
 * Not cloud-gated: registerCoreRoutes mounts /api/mcp in both editions. A core
 * server answers on the same path and advertises the canvas tool subset.
 *
 * `lib/api.ts` reads the same env var but falls back to `""` — a same-origin
 * base, which is right for `fetch` and useless in a shell command. A CLI needs
 * an absolute URL, so this needs a fallback of its own, and it must differ by
 * edition: `api.leenar.net` is right for the hosted console and actively wrong
 * for a self-hoster, who would paste a command aimed at OUR API and see it
 * authenticate against nothing. Falling back to the console's own origin is
 * correct when the API is reverse-proxied same-origin and, when it is not, at
 * least names a host they own instead of one they don't.
 */
const apiOrigin = () =>
  (import.meta.env.VITE_API_URL as string) ||
  (isCloud
    ? "https://api.leenar.net"
    : typeof window !== "undefined"
      ? window.location.origin
      : "");

const mcpAddCommand = (key: string) =>
  `claude mcp add --transport http leenar ${apiOrigin()}/api/mcp --header "Authorization: Bearer ${key}"`;
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
  const [copied, setCopied] = useState<"key" | "command" | null>(null);

  const copy = (what: "key" | "command", text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

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
          Read &amp; write tokens can create and deploy projects through the API
          — keep them secret. Read-only tokens can only list and inspect.
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
                onClick={() => copy("key", created.key)}
                className={COPY_BUTTON}
              >
                {copied === "key" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}{" "}
                {copied === "key" ? "Copied" : "Copy"}
              </button>
            </div>

            {/* The key is on screen exactly once, so this is the only moment a
                ready-to-run command can carry the real value. Without it the
                next step is: copy the key, find the docs, hand-write the flags. */}
            <p className="mt-4 text-[12px] text-muted-foreground">
              Or connect Claude Code in one command:
            </p>
            <div className="mt-2 flex items-start gap-2">
              <code className="flex-1 overflow-x-auto whitespace-pre rounded bg-background px-2 py-1.5 font-mono text-xs">
                {mcpAddCommand(created.key)}
              </code>
              <button
                onClick={() => copy("command", mcpAddCommand(created.key))}
                className={COPY_BUTTON}
              >
                {copied === "command" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}{" "}
                {copied === "command" ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Adds Leenar to the current project. Append{" "}
              <code className="font-mono">--scope user</code> for every project,
              then check it with{" "}
              <code className="font-mono">claude mcp list</code>.
              {!isCloud && (
                <>
                  {" "}
                  This server exposes the canvas tools — read a workspace, add a
                  service, wire an edge.
                </>
              )}
            </p>
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
