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
  startOAuthFlow,
  connectServiceToken,
  disconnectService,
} from "../lib/api";

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

const HEALTH_META: Record<string, { label: string; cls: string; dot: string }> =
  {
    valid: { label: "Healthy", cls: "text-emerald-400", dot: "bg-emerald-500" },
    expired: { label: "Expired", cls: "text-yellow-500", dot: "bg-yellow-500" },
    invalid: {
      label: "Invalid",
      cls: "text-destructive",
      dot: "bg-destructive",
    },
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
    } finally {
      setBusy(null);
      setDisconnectConfirm(null);
    }
  };

  const connectedCount = connected.size;

  return (
    <>
      <ConsoleTopBar title="Integrations" />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl p-6">
          {/* Page header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                Integrations
              </h1>
              <p className="mt-1 text-sm text-foreground/70">
                Connect your cloud providers so Leenar can provision and monitor
                your stack.
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {/* Stats */}
              <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-xs">
                <div className="text-center">
                  <div className="font-mono font-bold text-foreground">
                    {connectedCount}
                  </div>
                  <div className="text-muted-foreground">Connected</div>
                </div>
                <div className="h-6 w-px bg-border" />
                <div className="text-center">
                  <div className="font-mono font-bold text-foreground">
                    {SERVICES.length}
                  </div>
                  <div className="text-muted-foreground">Available</div>
                </div>
              </div>
              {/* Check health */}
              <button
                onClick={() =>
                  qc.invalidateQueries({ queryKey: ["connections-health"] })
                }
                disabled={healthQuery.isFetching || connectedCount === 0}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                <RefreshCw
                  className={`h-3 w-3 ${healthQuery.isFetching ? "animate-spin" : ""}`}
                />
                {healthQuery.isFetching ? "Checking…" : "Check status"}
              </button>
            </div>
          </div>

          {/* Service grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SERVICES.map((svc) => {
              const isConnected = connected.has(svc.id);
              const h = health[svc.id];
              const hMeta = h ? HEALTH_META[h.status] : null;
              const showTokenInput = tokenFor === svc.id && !isConnected;

              return (
                <div
                  key={svc.id}
                  className={`flex flex-col rounded-md border bg-card transition-colors ${
                    isConnected ? "border-foreground/10" : "border-border"
                  }`}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 p-4">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${
                        isConnected
                          ? "border-foreground/10 bg-secondary"
                          : "border-border bg-secondary/40"
                      }`}
                    >
                      <div className="h-4 w-4 [&_svg]:h-full [&_svg]:w-full">
                        {SERVICE_ICONS[svc.id as keyof typeof SERVICE_ICONS]}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {svc.name}
                        </span>
                        {isConnected && hMeta ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] ${hMeta.cls}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${hMeta.dot}`}
                            />
                            {hMeta.label}
                          </span>
                        ) : isConnected ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Connected
                          </span>
                        ) : null}
                      </div>
                      {isConnected && h?.account ? (
                        <p
                          className="mt-0.5 truncate text-[11px] text-muted-foreground"
                          title={h.accountDetail}
                        >
                          {h.account}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {svc.desc}
                      </p>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
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
                            <div className="rounded-md border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[11px] leading-relaxed text-yellow-500/80">
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
                              className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
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
                          <div className="flex flex-col gap-2 rounded-md border border-destructive/20 bg-destructive/5 p-3">
                            <p className="text-[11px] text-destructive/80">
                              Disconnect {svc.name}? This may break existing
                              deployments.
                            </p>
                            <div className="flex gap-2">
                              <button
                                onClick={() => setDisconnectConfirm(null)}
                                className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
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
                          <Button
                            onClick={() => setDisconnectConfirm(svc.id)}
                            variant="destructive"
                            size="sm"
                          >
                            Disconnect
                          </Button>
                        )}
                      </>
                    ) : svc.oauth ? (
                      <>
                        {isCloud && (
                          <button
                            onClick={() => doConnect(svc.id)}
                            disabled={connectOAuth.isPending}
                            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 disabled:opacity-50"
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
                            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background hover:opacity-90"
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
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-[11px] text-muted-foreground">
            More providers (Neon, Railway, AWS) coming soon.
          </p>
        </div>
      </div>

      {/* OAuth scope modal */}
      {scopeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setScopeModal(null)}
        >
          <div
            className="w-[420px] overflow-hidden rounded-md border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-medium text-foreground">
                Connect {SERVICES.find((s) => s.id === scopeModal)?.name}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Leenar will request the following permissions:
              </p>
            </div>
            <div className="space-y-1 px-5 py-4">
              {(OAUTH_SCOPES[scopeModal] ?? []).map(({ scope, reason }) => (
                <div key={scope} className="flex items-start gap-3 py-1.5">
                  <code className="mt-0.5 shrink-0 rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-foreground">
                    {scope}
                  </code>
                  <span className="text-[12px] text-muted-foreground">
                    {reason}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-4">
              <p className="mb-3 text-[11px] text-muted-foreground">
                You can revoke access at any time from your provider's account
                settings.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setScopeModal(null)}
                  className="flex-1 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const svc = scopeModal;
                    setScopeModal(null);
                    connectOAuth.mutate(svc);
                  }}
                  className="flex-1 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background hover:opacity-90"
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
          className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={onSave}
          disabled={saving || !value.trim()}
          className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

const SERVICE_ICONS = {
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="text-foreground/80">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  ),
  vercel: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="text-foreground/90">
      <path d="M24 22.525H0l12-21.05 12 21.05z" />
    </svg>
  ),
  supabase: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        fill="#3ECF8E"
        d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.295 12.64.706 13.5 1.456 13.5h8.933l.5 9.467c.014.986 1.259 1.41 1.873.637l9.262-11.653c.469-.59.058-1.45-.693-1.45h-8.933l-.498-9.465z"
      />
    </svg>
  ),
  resend: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="text-foreground/80">
      <path d="M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z" />
    </svg>
  ),
  cloudflare: (
    <svg viewBox="0 0 256 120" fill="none">
      <path
        d="M202.357 51.394L197.046 49.27C172.085 105.434 72.786 71.289 66.811 87.997c-.996 11.286 54.227 2.146 93.706 4.059 12.039.583 18.076 9.671 12.964 24.484l10.069.031c11.615-36.209 48.683-17.73 50.232-29.68-2.545-7.857-42.601 0-31.425-35.497z"
        fill="#fff"
      />
      <path
        d="M176.332 110.348c1.593-5.311 1.062-10.622-1.593-13.809-2.656-3.187-6.374-5.311-11.154-5.842L71.17 89.634c-.531 0-1.062-.531-1.593-.531-.531-.531-.531-1.062 0-1.593.531-1.062 1.062-1.593 2.124-1.593l92.946-1.062c11.154-.531 22.839-9.56 27.087-20.182l5.312-13.809c.531-.531 0-1.062-.531-1.593C191.203 22.182 166.772 2 138.091 2c-26.556 0-49.394 16.996-57.361 40.897-5.311-3.718-11.684-5.843-19.12-5.311-12.747 1.062-22.838 11.684-24.432 24.431-.531 3.187 0 6.374.532 9.56C16.996 72.108 0 89.104 0 110.348c0 2.124 0 3.718.531 5.842.531 1.063 1.593 1.594 2.125 1.594H172.614c1.062 0 2.125-.531 2.125-1.594l1.593-5.842z"
        fill="#F4811F"
      />
      <path
        d="M205.544 50.863h-2.656c-.531 0-1.062.531-1.593 1.062l-3.718 12.747c-1.593 5.311-1.062 10.622 1.594 13.809 2.655 3.187 6.373 5.311 11.153 5.842l19.652 1.063c.531 0 1.062.531 1.593.531.531.531.531 1.062 0 1.593-.531 1.063-1.062 1.594-2.124 1.594l-20.183 1.062c-11.154.531-22.839 9.56-27.087 20.182l-1.063 4.781c-.531.531 0 1.593 1.063 1.593h70.142c1.062 0 1.593-.531 1.593-1.593C256 101.32 256 96.539 256 91.759c0-22.839-22.838-40.896-50.456-40.896z"
        fill="#FAAD3F"
      />
    </svg>
  ),
};
