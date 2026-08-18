import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { ConsoleTopBar } from "./console";
import { useAuth } from "../context/auth";
import { isCloud } from "../lib/cloud";
import {
  getConnectedServices,
  checkConnectionHealth,
  listConnectionRows,
  daysUntil,
  startOAuthFlow,
  connectServiceToken,
  disconnectService,
} from "../lib/api";
import { HairGrid, HairCell } from "../components/console/HairGrid";
import { StateTag, type Tone } from "../components/console/StateTag";
import { Mono } from "../components/console/Rows";
import { PILL, PILL_QUIET, INPUT } from "../components/console/Field";

export const Route = createFileRoute("/console/integrations")({
  component: IntegrationsPage,
  head: () => ({ meta: [{ title: "Integrations — Leenar Console" }] }),
});

type Service = {
  id: string;
  name: string;
  desc: string;
  oauth: boolean;
  docs: string;
};

const SERVICES: Service[] = [
  {
    id: "github",
    name: "GitHub",
    desc: "Create repos and push code",
    oauth: true,
    docs: "https://github.com/settings/tokens",
  },
  {
    id: "vercel",
    name: "Vercel",
    desc: "Deploy projects and inject env vars",
    oauth: false,
    docs: "https://vercel.com/account/tokens",
  },
  {
    id: "supabase",
    name: "Supabase",
    desc: "Create databases for your projects",
    oauth: true,
    docs: "https://supabase.com/dashboard/account/tokens",
  },
  {
    id: "resend",
    name: "Resend",
    desc: "Send transactional emails via API",
    oauth: false,
    docs: "https://resend.com/api-keys?new=true",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    desc: "Deploy Workers and R2 object storage",
    oauth: false,
    docs: "https://dash.cloudflare.com/profile/api-tokens",
  },
];

const OAUTH_SCOPES: Record<string, { scope: string; reason: string }[]> = {
  github: [
    { scope: "repo", reason: "Create and push to repositories on your behalf" },
    { scope: "read:user", reason: "Read your GitHub username and profile" },
    {
      scope: "read:org",
      reason: "Detect which GitHub App installations are available",
    },
  ],
  supabase: [
    {
      scope: "projects:read + write",
      reason: "Create new Supabase projects in your organisation",
    },
    {
      scope: "database:read + write",
      reason: "Configure auth settings and RLS policies",
    },
    {
      scope: "organisations:read",
      reason: "List your organisations to pick the right one",
    },
  ],
};

/**
 * `valid`, `expired` and `invalid` are this surface's private words — none
 * of them is readable by the shared toneFor, and one caller does not justify
 * widening the console's vocabulary.
 */
const HEALTH_TONE: Record<string, Tone> = {
  valid: "ok",
  expired: "warn",
  invalid: "crit",
};

function IntegrationsPage() {
  const { session } = useAuth();
  const qc = useQueryClient();

  const connQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => getConnectedServices(session!),
    enabled: !!session,
  });
  const healthQuery = useQuery({
    queryKey: ["connections-health"],
    queryFn: () => checkConnectionHealth(session!),
    enabled: !!session && (connQuery.data?.length ?? 0) > 0,
  });
  // The rows carry expires_at; the endpoint has always sent it.
  const rowsQuery = useQuery({
    queryKey: ["connection-rows"],
    queryFn: () => listConnectionRows(session!),
    enabled: !!session,
  });
  const expiryFor = (svc: string) =>
    daysUntil(
      rowsQuery.data?.find((r) => r.service === svc)?.expires_at ?? null,
    );

  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(
    null,
  );
  const [scopeModal, setScopeModal] = useState<string | null>(null);

  const connected = new Set(connQuery.data ?? []);
  const health = healthQuery.data ?? {};

  const connectOAuth = useMutation({
    mutationFn: (svc: string) =>
      startOAuthFlow(svc, session!, window.location.href),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err) => {
      alert(
        `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    },
  });

  const doConnect = (svc: string) => {
    if (OAUTH_SCOPES[svc]) {
      setScopeModal(svc);
    } else {
      connectOAuth.mutate(svc);
    }
  };

  const saveToken = async (svc: string) => {
    const token = (
      (tokenInputs[svc] ?? tokenFor === svc) ? tokenInputs[svc] : ""
    )?.trim();
    if (!token) return;
    setBusy(svc);
    try {
      await connectServiceToken(svc, token, session!);
      setTokenFor(null);
      setTokenInputs((p) => ({ ...p, [svc]: "" }));
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["connections-health"] });
      qc.invalidateQueries({ queryKey: ["connection-rows"] });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (svc: string) => {
    setBusy(svc);
    try {
      await disconnectService(svc, session!);
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["connections-health"] });
      qc.invalidateQueries({ queryKey: ["connection-rows"] });
    } finally {
      setBusy(null);
      setDisconnectConfirm(null);
    }
  };

  const connectedCount = connected.size;

  return (
    <>
      <ConsoleTopBar
        title="Integrations"
        right={
          <>
            <span className="font-mono text-[11px] lowercase tabular-nums text-dim">
              {connectedCount}/{SERVICES.length} connected
            </span>
            <button
              onClick={() =>
                qc.invalidateQueries({ queryKey: ["connections-health"] })
              }
              disabled={healthQuery.isFetching || connectedCount === 0}
              className={PILL_QUIET}
            >
              <RefreshCw
                className={`h-3 w-3 ${healthQuery.isFetching ? "animate-spin" : ""}`}
              />
              {healthQuery.isFetching ? "Checking…" : "Check status"}
            </button>
          </>
        }
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* The <h1> that used to sit here is gone: ConsoleTopBar already
              names the page in the PageBar directly above. */}
          <p className="mb-6 text-[13px] text-muted-foreground">
            Connect your cloud providers so Leenar can provision and monitor
            your stack.
          </p>

          <HairGrid cols={2}>
            {SERVICES.map((svc) => {
              const isConnected = connected.has(svc.id);
              const h = health[svc.id];
              const days = expiryFor(svc.id);
              const showTokenInput = tokenFor === svc.id && !isConnected;

              // hot on the DISconnected cell: panel-hover belongs to the
              // one that still wants an action.
              return (
                <HairCell
                  key={svc.id}
                  hot={!isConnected}
                  className="flex flex-col gap-3 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border-soft text-foreground">
                      <span className="h-4 w-4 [&_svg]:h-full [&_svg]:w-full">
                        {SERVICE_ICONS[svc.id as keyof typeof SERVICE_ICONS]}
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-medium">
                          {svc.name}
                        </span>
                        {isConnected && (
                          <StateTag
                            tone={h ? (HEALTH_TONE[h.status] ?? "ok") : "ok"}
                            label={h ? h.status : "connected"}
                            dot
                          />
                        )}
                      </div>
                      {isConnected && h?.account && (
                        <p className="mt-1 truncate" title={h.accountDetail}>
                          <Mono>{h.account}</Mono>
                        </p>
                      )}
                      <p className="mt-1 text-[12px] text-muted-foreground">
                        {svc.desc}
                      </p>
                      {isConnected && days != null && (
                        // The expiry line: muted, and warn under 30 days —
                        // the CORE_SYNC_TOKEN precedent.
                        <p
                          className={`mt-1 font-mono text-[11px] lowercase tabular-nums ${
                            days <= 0
                              ? "text-crit"
                              : days < 30
                                ? "text-warn"
                                : "text-muted-foreground"
                          }`}
                        >
                          {days > 0
                            ? `expires in ${days}d`
                            : `expired ${Math.abs(days)}d ago`}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="flex flex-col gap-2 border-t border-border-soft pt-3">
                    {isConnected ? (
                      <>
                        {/* Health details */}
                        {h?.checkedAt && (
                          <p className="text-[11px] text-muted-foreground">
                            Last checked{" "}
                            {new Date(h.checkedAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        )}

                        {/* Cloudflare analytics warning */}
                        {svc.id === "cloudflare" &&
                          h?.status === "valid" &&
                          h?.incidentsReady === false && (
                            <div className="rounded-xl border border-warn/30 px-3 py-2 text-[11px] leading-relaxed text-warn">
                              ⚠ Incident monitoring is off — your token is
                              missing <strong>Account Analytics:Read</strong>.
                              Recreate the token with that permission to enable
                              Cloudflare incident detection.
                            </div>
                          )}

                        {/* Reconnect for expired/invalid OAuth */}
                        {isCloud &&
                          svc.oauth &&
                          h &&
                          (h.status === "expired" ||
                            h.status === "invalid") && (
                            <button
                              onClick={() => doConnect(svc.id)}
                              className={`self-start ${PILL_QUIET}`}
                            >
                              Reconnect via OAuth
                            </button>
                          )}

                        {/* Supabase PAT fallback for expired */}
                        {svc.id === "supabase" &&
                          h &&
                          (h.status === "expired" ||
                            h.status === "invalid") && (
                            <TokenInputRow
                              placeholder="sbp_… Personal Access Token"
                              value={tokenInputs[svc.id] ?? ""}
                              onChange={(v) =>
                                setTokenInputs((p) => ({ ...p, [svc.id]: v }))
                              }
                              onSave={() => saveToken(svc.id)}
                              saving={busy === svc.id}
                              hint={
                                <a
                                  href="https://supabase.com/dashboard/account/tokens"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                >
                                  Personal Access Token{" "}
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              }
                            />
                          )}

                        {/* Disconnect flow */}
                        {disconnectConfirm === svc.id ? (
                          <div className="flex flex-col gap-2 rounded-xl border border-crit/30 p-3">
                            <p className="text-[12px] text-crit">
                              Disconnect {svc.name}? This may break existing
                              deployments.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setDisconnectConfirm(null)}
                                className={`flex-1 justify-center ${PILL_QUIET}`}
                              >
                                Cancel
                              </button>
                              <Button
                                onClick={() => disconnect(svc.id)}
                                disabled={busy === svc.id}
                                variant="destructive"
                                size="sm"
                                className="flex-1"
                              >
                                {busy === svc.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  "Disconnect"
                                )}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          // Decision C: the connected cell has no primary
                          // action, but disconnecting must stay reachable —
                          // the design as written would have deleted the only
                          // way to do it.
                          <button
                            onClick={() => setDisconnectConfirm(svc.id)}
                            className="self-start font-mono text-[11px] lowercase text-dim transition-colors hover:text-crit"
                          >
                            disconnect
                          </button>
                        )}
                      </>
                    ) : svc.oauth ? (
                      <>
                        {isCloud && (
                          <button
                            onClick={() => doConnect(svc.id)}
                            disabled={connectOAuth.isPending}
                            className={`justify-center ${PILL}`}
                          >
                            {connectOAuth.isPending && (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            )}
                            Connect via OAuth
                          </button>
                        )}
                        {svc.id === "supabase" && (
                          <TokenInputRow
                            placeholder="sbp_… Personal Access Token"
                            value={tokenInputs[svc.id] ?? ""}
                            onChange={(v) =>
                              setTokenInputs((p) => ({ ...p, [svc.id]: v }))
                            }
                            onSave={() => saveToken(svc.id)}
                            saving={busy === svc.id}
                            hint={
                              <span className="text-muted-foreground">
                                Or use a{" "}
                                <a
                                  href="https://supabase.com/dashboard/account/tokens"
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-foreground/70 underline hover:text-foreground"
                                >
                                  Personal Access Token
                                </a>{" "}
                                — never expires
                              </span>
                            }
                          />
                        )}
                        {svc.id === "github" && (
                          <TokenInputRow
                            placeholder="ghp_… Personal Access Token"
                            value={tokenInputs[svc.id] ?? ""}
                            onChange={(v) =>
                              setTokenInputs((p) => ({ ...p, [svc.id]: v }))
                            }
                            onSave={() => saveToken(svc.id)}
                            saving={busy === svc.id}
                            hint={
                              <span className="text-muted-foreground">
                                Or use a{" "}
                                <a
                                  href={svc.docs}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-foreground/70 underline hover:text-foreground"
                                >
                                  Personal Access Token
                                </a>{" "}
                                — never expires
                              </span>
                            }
                          />
                        )}
                        <a
                          href={svc.docs}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Setup guide <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </>
                    ) : (
                      <>
                        {showTokenInput ? (
                          <TokenInputRow
                            placeholder={`Paste ${svc.name} API token`}
                            value={tokenInputs[svc.id] ?? ""}
                            onChange={(v) =>
                              setTokenInputs((p) => ({ ...p, [svc.id]: v }))
                            }
                            onSave={() => saveToken(svc.id)}
                            saving={busy === svc.id}
                            onCancel={() => setTokenFor(null)}
                          />
                        ) : (
                          <button
                            onClick={() => setTokenFor(svc.id)}
                            className={`justify-center ${PILL}`}
                          >
                            Connect
                          </button>
                        )}
                        {svc.id === "cloudflare" && (
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Token needs: Workers Scripts:Edit, Account:Read,
                            R2:Edit, Account Analytics:Read.
                          </p>
                        )}
                        <a
                          href={svc.docs}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Get API token <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </>
                    )}
                  </div>
                </HairCell>
              );
            })}
          </HairGrid>

          {/* Footer */}
          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            More providers (Neon, Railway, AWS) coming soon.
          </p>
        </div>
      </div>

      {/* OAuth scope modal */}
      {scopeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setScopeModal(null)}
        >
          <div
            className="w-[420px] overflow-hidden rounded-2xl border border-border bg-popover shadow-[var(--raise-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border-soft px-5 py-4">
              <h2 className="text-[15px] font-medium text-foreground">
                Connect {SERVICES.find((s) => s.id === scopeModal)?.name}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Leenar will request the following permissions:
              </p>
            </div>
            <div className="space-y-1 px-5 py-4">
              {(OAUTH_SCOPES[scopeModal] ?? []).map(({ scope, reason }) => (
                <div key={scope} className="flex items-start gap-3 py-1.5">
                  <code className="mt-0.5 shrink-0 rounded-lg border border-border-soft bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                    {scope}
                  </code>
                  <span className="text-[12px] text-muted-foreground">
                    {reason}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border-soft px-5 py-4">
              <p className="mb-3 text-[11px] text-muted-foreground">
                You can revoke access at any time from your provider's account
                settings.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setScopeModal(null)}
                  className={`flex-1 justify-center ${PILL_QUIET}`}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const svc = scopeModal;
                    setScopeModal(null);
                    connectOAuth.mutate(svc);
                  }}
                  className={`flex-1 justify-center ${PILL}`}
                >
                  Authorize →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TokenInputRow({
  placeholder,
  value,
  onChange,
  onSave,
  saving,
  onCancel,
  hint,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  saving: boolean;
  onCancel?: () => void;
  hint?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {hint && <div className="text-[11px]">{hint}</div>}
      <div className="flex gap-1.5">
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSave()}
          placeholder={placeholder}
          autoComplete="new-password"
          spellCheck={false}
          className={`flex-1 font-mono ${INPUT}`}
        />
        <button
          onClick={onSave}
          disabled={saving || !value.trim()}
          className={PILL_QUIET}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
        {onCancel && (
          <button onClick={onCancel} className={PILL_QUIET}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

const SERVICE_ICONS = {
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  ),
  vercel: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 22.525H0l12-21.05 12 21.05z" />
    </svg>
  ),
  supabase: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        fill="currentColor"
        d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.295 12.64.706 13.5 1.456 13.5h8.933l.5 9.467c.014.986 1.259 1.41 1.873.637l9.262-11.653c.469-.59.058-1.45-.693-1.45h-8.933l-.498-9.465z"
      />
    </svg>
  ),
  resend: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <path d="M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z" />
    </svg>
  ),
  cloudflare: (
    // Two paths, not three. The mark's third path was a white swoosh drawn
    // over the body purely as a lighter-colour accent — it was invisible on
    // the light theme, and in monochrome it would erase the silhouette it
    // sits on. The cloud reads without it.
    <svg viewBox="0 0 256 120" fill="currentColor">
      <path d="M176.332 110.348c1.593-5.311 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.311-11.154-5.842L71.17 89.634c-.531 0-1.062-.531-1.593-.531-.531-.531-.531-1.062 0-1.593.531-1.062 1.062-1.593 2.124-1.593l92.946-1.062c11.154-.531 22.839-9.56 27.087-20.182l5.312-13.809c.531-.531 0-1.062-.531-1.593C191.203 22.182 166.772 2 138.091 2c-26.556 0-49.394 16.996-57.361 40.897-5.311-3.718-11.684-5.843-19.12-5.311-12.747 1.062-22.838 11.684-24.432 24.431-.531 3.187 0 6.374.532 9.56C16.996 72.108 0 89.104 0 110.348c0 2.124 0 3.718.531 5.842.531 1.063 1.593 1.594 2.125 1.594H172.614c1.062 0 2.125-.531 2.125-1.594l1.593-5.842z" />
      <path d="M205.544 50.863h-2.656c-.531 0-1.062.531-1.593 1.062l-3.718 12.747c-1.593 5.311-1.062 10.622 1.594 13.809 2.655 3.187 6.373 5.311 11.153 5.842l19.652 1.063c.531 0 1.062.531 1.593.531.531.531.531 1.062 0 1.593-.531 1.063-1.062 1.594-2.124 1.594l-20.183 1.062c-11.154.531-22.839 9.56-27.087 20.182l-1.063 4.781c-.531.531 0 1.593 1.063 1.593h70.142c1.062 0 1.593-.531 1.593-1.593C256 101.32 256 96.539 256 91.759c0-22.839-22.838-40.896-50.456-40.896z" />
    </svg>
  ),
};
