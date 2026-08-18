import { useState, useEffect } from "react";
import { X, Plus, Loader2, KeyRound, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  getEnvSecrets,
  putEnvSecret,
  deleteEnvSecretApi,
} from "../../../lib/api";

interface VariablesTabProps {
  node: any;
  localData: any;
  handleUpdate: (field: string, value: any) => void;
  isProvisioned: boolean;
  workflowId?: string;
  currentEnvId?: string | null;
  session?: import("@supabase/supabase-js").Session | null;
}

export function VariablesTab({
  node,
  localData,
  handleUpdate,
  isProvisioned,
  workflowId,
  currentEnvId,
  session,
}: VariablesTabProps) {
  const provider = localData.provider;

  // Env secrets state
  const [envSecrets, setEnvSecrets] = useState<
    Array<{ node_id: string; env_var_key: string; updated_at: string }>
  >([]);
  const [envSecretsOpen, setEnvSecretsOpen] = useState(false);
  const [newSecretKey, setNewSecretKey] = useState("");
  const [newSecretValue, setNewSecretValue] = useState("");
  const [savingSecret, setSavingSecret] = useState(false);

  useEffect(() => {
    if (!workflowId || !currentEnvId || !session || !node?.id) return;
    getEnvSecrets(workflowId, currentEnvId, session).then((rows) => {
      setEnvSecrets(rows.filter((r) => r.node_id === node.id));
    });
  }, [workflowId, currentEnvId, session, node?.id]);

  const handleSaveSecret = async () => {
    const key = newSecretKey.trim().toUpperCase();
    const value = newSecretValue;
    if (!key || !value || !workflowId || !currentEnvId || !session || !node?.id)
      return;
    setSavingSecret(true);
    try {
      await putEnvSecret(
        workflowId,
        currentEnvId,
        node.id,
        key,
        value,
        session,
      );
      setEnvSecrets((prev) => {
        const next = prev.filter((s) => s.env_var_key !== key);
        return [
          ...next,
          {
            node_id: node.id,
            env_var_key: key,
            updated_at: new Date().toISOString(),
          },
        ];
      });
      setNewSecretKey("");
      setNewSecretValue("");
    } catch {
      toast.error("Failed to save secret. Please try again.");
    } finally {
      setSavingSecret(false);
    }
  };

  const handleDeleteSecret = async (key: string) => {
    if (!workflowId || !currentEnvId || !session || !node?.id) return;
    await deleteEnvSecretApi(
      workflowId,
      currentEnvId,
      node.id,
      key,
      session,
    ).catch(() => {});
    setEnvSecrets((prev) => prev.filter((s) => s.env_var_key !== key));
  };

  if (!node) return null;

  return (
    <div className="space-y-4">
      {/* ── Cloudflare: Worker env vars ── */}
      {provider === "cloudflare" &&
        (localData.cloudflareService === "workers" ||
          !localData.cloudflareService) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <p className="font-mono text-[10px] lowercase text-dim">
                Worker Env Vars
              </p>
              {!isProvisioned && (
                <button
                  onClick={() => {
                    const current: Array<{
                      key: string;
                      value: string;
                    }> = (localData.cfWorkerEnvVars as any) ?? [];
                    handleUpdate("cfWorkerEnvVars", [
                      ...current,
                      { key: "", value: "" },
                    ]);
                  }}
                  className="flex items-center gap-1 text-[11px] text-dim hover:text-muted-foreground transition-colors"
                >
                  <Plus size={10} />
                  Add
                </button>
              )}
            </div>
            {(
              localData.cfWorkerEnvVars as
                | Array<{ key: string; value: string }>
                | undefined
            )?.map((env, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder="KEY"
                  value={env.key}
                  spellCheck={false}
                  onChange={(e) => {
                    const next = [
                      ...((localData.cfWorkerEnvVars ?? []) as Array<{
                        key: string;
                        value: string;
                      }>),
                    ];
                    next[idx] = {
                      ...next[idx],
                      key: e.target.value.toUpperCase(),
                    };
                    handleUpdate("cfWorkerEnvVars", next);
                  }}
                  disabled={isProvisioned}
                  className="flex-1 min-w-0 bg-secondary border border-border rounded-lg py-1.5 px-2.5 text-foreground focus:border-foreground/30 outline-none transition-all text-[12px] font-mono"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={env.value}
                  spellCheck={false}
                  autoComplete="new-password"
                  onChange={(e) => {
                    const next = [
                      ...((localData.cfWorkerEnvVars ?? []) as Array<{
                        key: string;
                        value: string;
                      }>),
                    ];
                    next[idx] = { ...next[idx], value: e.target.value };
                    handleUpdate("cfWorkerEnvVars", next);
                  }}
                  disabled={isProvisioned}
                  className="flex-1 min-w-0 bg-secondary border border-border rounded-lg py-1.5 px-2.5 text-foreground focus:border-foreground/30 outline-none transition-all text-[12px] font-mono"
                />
                {!isProvisioned && (
                  <button
                    onClick={() => {
                      const next = (
                        (localData.cfWorkerEnvVars ?? []) as Array<{
                          key: string;
                          value: string;
                        }>
                      ).filter((_, i) => i !== idx);
                      handleUpdate("cfWorkerEnvVars", next);
                    }}
                    className="p-1 text-dim hover:text-crit transition-colors rounded flex-shrink-0"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            {(!localData.cfWorkerEnvVars ||
              (localData.cfWorkerEnvVars as []).length === 0) && (
              <p className="text-[11px] text-dim px-0.5">
                Set secrets injected into your Worker runtime (e.g.
                DATABASE_URL).
              </p>
            )}
          </div>
        )}

      {/* ── Custom env vars (Vercel only) ── */}
      {provider === "vercel" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <p className="font-mono text-[10px] lowercase text-dim">
              Custom Env Vars
            </p>
            <button
              onClick={() => {
                const current: Array<{ key: string; value: string }> =
                  localData.customEnvVars ?? [];
                handleUpdate("customEnvVars", [
                  ...current,
                  { key: "", value: "" },
                ]);
              }}
              className="flex items-center gap-1 text-[11px] text-dim hover:text-muted-foreground transition-colors"
            >
              <Plus size={10} />
              Add
            </button>
          </div>
          {(
            localData.customEnvVars as
              | Array<{ key: string; value: string }>
              | undefined
          )?.map((env, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <input
                type="text"
                placeholder="KEY"
                value={env.key}
                spellCheck={false}
                onChange={(e) => {
                  const next = [...(localData.customEnvVars ?? [])] as Array<{
                    key: string;
                    value: string;
                  }>;
                  next[idx] = {
                    ...next[idx],
                    key: e.target.value.toUpperCase(),
                  };
                  handleUpdate("customEnvVars", next);
                }}
                className={`flex-1 min-w-0 bg-secondary border border-border rounded-lg py-1.5 px-2.5 text-foreground focus:border-foreground/30 outline-none transition-all text-[12px] font-mono`}
              />
              <input
                type="text"
                placeholder="value"
                value={env.value}
                spellCheck={false}
                autoComplete="new-password"
                onChange={(e) => {
                  const next = [...(localData.customEnvVars ?? [])] as Array<{
                    key: string;
                    value: string;
                  }>;
                  next[idx] = { ...next[idx], value: e.target.value };
                  handleUpdate("customEnvVars", next);
                }}
                className={`flex-1 min-w-0 bg-secondary border border-border rounded-lg py-1.5 px-2.5 text-foreground focus:border-foreground/30 outline-none transition-all text-[12px] font-mono`}
              />
              <button
                onClick={() => {
                  const next = (
                    (localData.customEnvVars ?? []) as Array<{
                      key: string;
                      value: string;
                    }>
                  ).filter((_, i) => i !== idx);
                  handleUpdate("customEnvVars", next);
                }}
                className="p-1 text-dim hover:text-crit transition-colors rounded flex-shrink-0"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {(!localData.customEnvVars ||
            (localData.customEnvVars as []).length === 0) && (
            <p className="text-[11px] text-dim px-0.5">
              Add secrets like STRIPE_SECRET_KEY — injected into Vercel on
              deploy.
            </p>
          )}
        </div>
      )}

      {/* Env secret overrides — only when a node is selected and env is set */}
      {node && currentEnvId && workflowId && session && (
        <div className="pt-1">
          <button
            onClick={() => setEnvSecretsOpen((v) => !v)}
            className="w-full flex items-center gap-2 text-left"
          >
            <KeyRound size={12} className="text-dim" />
            <span className="flex-1 font-mono text-[10px] lowercase text-dim">
              Env Overrides
            </span>
            <ChevronDown
              size={10}
              className={`text-dim transition-transform ${envSecretsOpen ? "rotate-180" : ""}`}
            />
          </button>

          {envSecretsOpen && (
            <div className="mt-2 space-y-1.5">
              {envSecrets.map((s) => (
                <div key={s.env_var_key} className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground flex-1 truncate">
                    {s.env_var_key}
                  </span>
                  <span className="text-[10px] font-mono text-dim">••••</span>
                  <button
                    onClick={() => handleDeleteSecret(s.env_var_key)}
                    className="p-1 rounded text-dim hover:text-crit hover:bg-crit/10 transition-all"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              ))}

              <div className="flex items-center gap-1.5 mt-2">
                <input
                  placeholder="KEY"
                  value={newSecretKey}
                  onChange={(e) =>
                    setNewSecretKey(
                      e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                    )
                  }
                  className="w-28 bg-[var(--hover)] border border-border rounded px-2 py-1 text-[11px] font-mono text-foreground placeholder:text-dim outline-none focus:border-primary/30"
                />
                <input
                  placeholder="value"
                  type="password"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  className="flex-1 bg-[var(--hover)] border border-border rounded px-2 py-1 text-[11px] text-foreground placeholder:text-dim outline-none focus:border-primary/30"
                />
                <button
                  onClick={handleSaveSecret}
                  disabled={savingSecret || !newSecretKey || !newSecretValue}
                  className="p-1.5 rounded border border-border text-foreground hover:bg-[var(--hover)] transition-all disabled:opacity-40"
                >
                  {savingSecret ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Plus size={10} />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
