import { useState, useEffect, useRef } from "react";
import { X, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type {
  ResendDomain,
  ResendDomainRecord,
  VercelDomain,
} from "../../../lib/api";
import { inputCls } from "../Sidebar";

interface DomainsTabProps {
  node: any;
  localData: any;
  isProvisioned: boolean;
  onVercelDomains?: () => Promise<VercelDomain[]>;
  onAddVercelDomain?: (domain: string) => Promise<VercelDomain>;
  onRemoveVercelDomain?: (domain: string) => Promise<void>;
  onAddCfDns?: (
    domain: VercelDomain,
  ) => Promise<{ added: string[]; skipped: string[] }>;
  onResendDomains?: () => Promise<ResendDomain[]>;
  onCreateResendDomain?: (name: string) => Promise<ResendDomain>;
  onResendDomainRecords?: (domainId: string) => Promise<ResendDomainRecord[]>;
  onDeleteResendDomain?: (domainId: string) => Promise<void>;
}

export function DomainsTab({
  node,
  localData,
  isProvisioned,
  onVercelDomains,
  onAddVercelDomain,
  onRemoveVercelDomain,
  onAddCfDns,
  onResendDomains,
  onCreateResendDomain,
  onResendDomainRecords,
  onDeleteResendDomain,
}: DomainsTabProps) {
  const provider = localData.provider;

  // Vercel domain state
  const [vercelDomains, setVercelDomains] = useState<VercelDomain[] | null>(
    null,
  );
  const [vercelDomainLoading, setVercelDomainLoading] = useState(false);
  const [vercelDomainError, setVercelDomainError] = useState<string | null>(
    null,
  );
  const [newDomain, setNewDomain] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);
  const [cfDnsPrompt, setCfDnsPrompt] = useState<VercelDomain | null>(null);
  const [cfDnsAdding, setCfDnsAdding] = useState(false);
  const [cfDnsAdded, setCfDnsAdded] = useState<string[] | null>(null);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const vercelDomainFetchedRef = useRef(false);
  const onVercelDomainsRef = useRef(onVercelDomains);
  useEffect(() => {
    onVercelDomainsRef.current = onVercelDomains;
  }, [onVercelDomains]);

  useEffect(() => {
    vercelDomainFetchedRef.current = false;
    setVercelDomains(null);
    setVercelDomainError(null);
    setNewDomain("");
  }, [node?.id]);

  useEffect(() => {
    if (
      node?.data?.provider !== "vercel" ||
      !node?.data?.vercelProjectId ||
      !onVercelDomains ||
      vercelDomainFetchedRef.current
    )
      return;
    vercelDomainFetchedRef.current = true;
    setVercelDomainLoading(true);
    onVercelDomains()
      .then(setVercelDomains)
      .catch((err) =>
        setVercelDomainError(
          err instanceof Error ? err.message : "Failed to load domains",
        ),
      )
      .finally(() => setVercelDomainLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, node?.data?.provider, node?.data?.vercelProjectId]);

  // Poll unverified Vercel domains every 10s until all are verified
  useEffect(() => {
    const hasUnverified = vercelDomains?.some((d) => !d.verified);
    if (!hasUnverified) return;
    const id = setInterval(async () => {
      try {
        const fresh = await onVercelDomainsRef.current?.();
        if (fresh) setVercelDomains(fresh);
      } catch {
        /* ignore poll failures */
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [vercelDomains]);

  const handleAddVercelDomain = async () => {
    if (!newDomain.trim() || addingDomain || !onAddVercelDomain) return;
    setAddingDomain(true);
    setVercelDomainError(null);
    setCfDnsAdded(null);
    setCfDnsPrompt(null);
    try {
      const d = await onAddVercelDomain(newDomain.trim());
      setVercelDomains((prev) => [...(prev ?? []), d]);
      setNewDomain("");
      if (d.cfAvailable) setCfDnsPrompt(d);
    } catch (err) {
      setVercelDomainError(
        err instanceof Error ? err.message : "Failed to add domain",
      );
    } finally {
      setAddingDomain(false);
    }
  };

  const handleAddCfDns = async () => {
    if (!cfDnsPrompt || !onAddCfDns) return;
    setCfDnsAdding(true);
    try {
      const result = await onAddCfDns(cfDnsPrompt);
      setCfDnsAdded(result.added);
    } catch {
      // silently ignore — user can add manually
    } finally {
      setCfDnsAdding(false);
      setCfDnsPrompt(null);
    }
  };

  const handleRemoveVercelDomain = async (domain: string) => {
    if (!onRemoveVercelDomain) return;
    setRemovingDomain(domain);
    try {
      await onRemoveVercelDomain(domain);
      setVercelDomains((prev) => (prev ?? []).filter((d) => d.name !== domain));
    } catch (err) {
      setVercelDomainError(
        err instanceof Error ? err.message : "Failed to remove domain",
      );
    } finally {
      setRemovingDomain(null);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Resend node domain management state
  const [resendNodeDomains, setResendNodeDomains] = useState<
    ResendDomain[] | null
  >(null);
  const [resendNodeDomainLoading, setResendNodeDomainLoading] = useState(false);
  const [resendNodeDomainError, setResendNodeDomainError] = useState<
    string | null
  >(null);
  const [resendNodeRecords, setResendNodeRecords] = useState<
    Record<string, ResendDomainRecord[]>
  >({});
  const [expandedDomainId, setExpandedDomainId] = useState<string | null>(null);
  const [newResendDomain, setNewResendDomain] = useState("");
  const [addingResendDomain, setAddingResendDomain] = useState(false);
  const [removingResendDomainId, setRemovingResendDomainId] = useState<
    string | null
  >(null);
  const resendNodeDomainFetchedRef = useRef(false);
  const onResendDomainsRef = useRef(onResendDomains);
  useEffect(() => {
    onResendDomainsRef.current = onResendDomains;
  }, [onResendDomains]);

  useEffect(() => {
    resendNodeDomainFetchedRef.current = false;
    setResendNodeDomains(null);
    setResendNodeDomainError(null);
    setResendNodeRecords({});
    setExpandedDomainId(null);
    setNewResendDomain("");
  }, [node?.id]);

  useEffect(() => {
    if (
      node?.data?.provider !== "resend" ||
      !onResendDomains ||
      resendNodeDomainFetchedRef.current
    )
      return;
    resendNodeDomainFetchedRef.current = true;
    setResendNodeDomainLoading(true);
    onResendDomains()
      .then(setResendNodeDomains)
      .catch((err) =>
        setResendNodeDomainError(
          err instanceof Error ? err.message : "Failed to load domains",
        ),
      )
      .finally(() => setResendNodeDomainLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, node?.data?.provider]);

  // Poll non-verified Resend domains every 15s until all are verified
  useEffect(() => {
    const hasUnverified = resendNodeDomains?.some(
      (d) => d.status !== "verified",
    );
    if (!hasUnverified) return;
    const id = setInterval(async () => {
      try {
        const fresh = await onResendDomainsRef.current?.();
        if (fresh) setResendNodeDomains(fresh);
      } catch {
        /* ignore poll failures */
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [resendNodeDomains]);

  const handleToggleResendDomainRecords = async (domainId: string) => {
    if (expandedDomainId === domainId) {
      setExpandedDomainId(null);
      return;
    }
    setExpandedDomainId(domainId);
    if (resendNodeRecords[domainId] || !onResendDomainRecords) return;
    try {
      const records = await onResendDomainRecords(domainId);
      setResendNodeRecords((prev) => ({ ...prev, [domainId]: records }));
    } catch {
      toast.error("Failed to load DNS records. Collapse and try again.");
    }
  };

  const handleCreateResendDomain = async () => {
    if (!newResendDomain.trim() || addingResendDomain || !onCreateResendDomain)
      return;
    setAddingResendDomain(true);
    setResendNodeDomainError(null);
    try {
      const d = await onCreateResendDomain(newResendDomain.trim());
      setResendNodeDomains((prev) => [...(prev ?? []), d]);
      setNewResendDomain("");
    } catch (err) {
      setResendNodeDomainError(
        err instanceof Error ? err.message : "Failed to add domain",
      );
    } finally {
      setAddingResendDomain(false);
    }
  };

  const handleDeleteResendDomain = async (domainId: string) => {
    if (!onDeleteResendDomain) return;
    setRemovingResendDomainId(domainId);
    try {
      await onDeleteResendDomain(domainId);
      setResendNodeDomains((prev) =>
        (prev ?? []).filter((d) => d.id !== domainId),
      );
    } catch (err) {
      setResendNodeDomainError(
        err instanceof Error ? err.message : "Failed to remove domain",
      );
    } finally {
      setRemovingResendDomainId(null);
    }
  };

  if (!node) return null;

  return (
    <div className="space-y-4">
      {/* ── Resend: Domain Management ── */}
      {provider === "resend" && (
        <>
          <p className="px-1 pt-1 font-mono text-[10px] lowercase text-dim">
            Sending Domains
          </p>
          {resendNodeDomainLoading ? (
            <div className="flex items-center gap-1.5 text-dim text-[12px] py-2">
              <Loader2 size={11} className="animate-spin" />
              <span>Loading domains…</span>
            </div>
          ) : (
            <div className="space-y-2">
              {resendNodeDomains && resendNodeDomains.length > 0 && (
                <div className="space-y-1.5">
                  {resendNodeDomains.map((d) => {
                    const statusColor =
                      d.status === "verified"
                        ? "bg-ok"
                        : d.status === "permanent_failure"
                          ? "bg-crit"
                          : d.status === "temporary_failure"
                            ? "bg-warn"
                            : "bg-warn";
                    const isExpanded = expandedDomainId === d.id;
                    const records = resendNodeRecords[d.id];
                    return (
                      <div
                        key={d.id}
                        className="rounded-lg bg-[var(--hover)] border border-border-soft overflow-hidden"
                      >
                        <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}${d.status !== "verified" ? " animate-pulse" : ""}`}
                            />
                            <span className="text-[13px] text-foreground font-mono truncate">
                              {d.name}
                            </span>
                            {d.status !== "verified" && (
                              <button
                                onClick={() =>
                                  handleToggleResendDomainRecords(d.id)
                                }
                                className="shrink-0 text-[11px] text-warn transition-opacity hover:opacity-80"
                              >
                                {isExpanded ? "hide DNS" : "DNS records"}
                              </button>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteResendDomain(d.id)}
                            disabled={removingResendDomainId === d.id}
                            className="text-dim hover:text-crit transition-colors flex-shrink-0"
                          >
                            {removingResendDomainId === d.id ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <X size={10} />
                            )}
                          </button>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border-soft px-2.5 py-2 space-y-1.5">
                            {records ? (
                              records.map((r, i) => (
                                <div
                                  key={i}
                                  className="rounded bg-warn/10 border border-warn/20 p-2 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] font-mono text-muted-foreground">
                                      {r.type} · {r.record}
                                    </span>
                                    <button
                                      onClick={() =>
                                        copyToClipboard(
                                          r.value,
                                          `resend-${d.id}-${i}`,
                                        )
                                      }
                                      className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                      {copiedKey === `resend-${d.id}-${i}`
                                        ? "✓"
                                        : "copy"}
                                    </button>
                                  </div>
                                  <p className="text-[11px] font-mono text-muted-foreground truncate">
                                    {r.name}
                                  </p>
                                  <p className="text-[11px] font-mono text-dim break-all">
                                    {r.value}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <div className="flex items-center gap-1.5 text-dim text-[11px]">
                                <Loader2 size={9} className="animate-spin" />
                                <span>Loading DNS records…</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {resendNodeDomainError && (
                <p className="text-[12px] text-crit">{resendNodeDomainError}</p>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="yourdomain.com"
                  value={newResendDomain}
                  onChange={(e) => setNewResendDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateResendDomain();
                  }}
                  className={`${inputCls(false)} flex-1`}
                />
                <button
                  onClick={handleCreateResendDomain}
                  disabled={!newResendDomain.trim() || addingResendDomain}
                  className="px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center"
                >
                  {addingResendDomain ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Vercel: Custom Domains (provisioned only) ── */}
      {provider === "vercel" && isProvisioned && localData.vercelProjectId && (
        <>
          <p className="px-1 pt-1 font-mono text-[10px] lowercase text-dim">
            Custom Domains
          </p>
          {vercelDomainLoading ? (
            <div className="flex items-center gap-1.5 text-dim text-[12px] py-2">
              <Loader2 size={11} className="animate-spin" />
              <span>Loading domains…</span>
            </div>
          ) : (
            <div className="space-y-2">
              {vercelDomains && vercelDomains.length > 0 && (
                <div className="space-y-1.5">
                  {vercelDomains.map((d) => (
                    <div
                      key={d.name}
                      className="rounded-lg bg-[var(--hover)] border border-border-soft p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.verified ? "bg-ok" : "bg-warn animate-pulse"}`}
                          />
                          <span className="text-[13px] text-foreground font-mono truncate">
                            {d.name}
                          </span>
                        </div>
                        <button
                          onClick={() => handleRemoveVercelDomain(d.name)}
                          disabled={removingDomain === d.name}
                          className="text-dim hover:text-crit transition-colors flex-shrink-0"
                        >
                          {removingDomain === d.name ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <X size={10} />
                          )}
                        </button>
                      </div>
                      {!d.verified && (
                        <div className="space-y-1.5">
                          {d.cname && (
                            <div className="rounded bg-warn/10 border border-warn/20 p-2 space-y-1">
                              <p className="font-mono text-[10px] lowercase text-warn">
                                Add DNS record to route traffic
                              </p>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-mono text-dim">
                                  CNAME
                                </span>
                                <span className="text-[11px] font-mono text-muted-foreground truncate mx-1">
                                  {d.name}
                                </span>
                                <button
                                  onClick={() =>
                                    copyToClipboard(d.cname!, `${d.name}-cname`)
                                  }
                                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex-shrink-0 flex items-center gap-0.5 transition-colors"
                                >
                                  {copiedKey === `${d.name}-cname`
                                    ? "✓"
                                    : "copy"}
                                </button>
                              </div>
                              <p className="text-[11px] font-mono text-muted-foreground break-all">
                                {d.cname}
                              </p>
                            </div>
                          )}
                          {d.verification?.map((v, i) => (
                            <div
                              key={i}
                              className="rounded bg-warn/10 border border-warn/20 p-2 space-y-1"
                            >
                              <p className="font-mono text-[10px] lowercase text-warn">
                                Add DNS record to verify
                              </p>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-mono text-dim">
                                  {v.type}
                                </span>
                                <span className="text-[11px] font-mono text-muted-foreground truncate mx-1">
                                  {v.domain}
                                </span>
                                <button
                                  onClick={() =>
                                    copyToClipboard(v.value, `${d.name}-${i}`)
                                  }
                                  className="text-[11px] font-mono text-muted-foreground hover:text-foreground flex-shrink-0 flex items-center gap-0.5 transition-colors"
                                >
                                  {copiedKey === `${d.name}-${i}`
                                    ? "✓"
                                    : "copy"}
                                </button>
                              </div>
                              <p className="text-[11px] font-mono text-muted-foreground break-all">
                                {v.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {vercelDomainError && (
                <p className="text-[12px] text-crit">{vercelDomainError}</p>
              )}
              {cfDnsPrompt && (
                <div
                  style={{
                    background:
                      "color-mix(in srgb, var(--warn) 8%, transparent)",
                    border:
                      "1px solid color-mix(in srgb, var(--warn) 30%, transparent)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <p
                    className="text-[12px]"
                    style={{ color: "var(--foreground)", margin: 0 }}
                  >
                    Your Cloudflare account is connected. Add DNS records
                    automatically?
                  </p>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={handleAddCfDns}
                      disabled={cfDnsAdding}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "none",
                        background: "var(--foreground)",
                        color: "var(--primary-foreground)",
                        cursor: cfDnsAdding ? "not-allowed" : "pointer",
                        opacity: cfDnsAdding ? 0.6 : 1,
                      }}
                    >
                      {cfDnsAdding ? "Adding…" : "Yes, add them"}
                    </button>
                    <button
                      onClick={() => setCfDnsPrompt(null)}
                      disabled={cfDnsAdding}
                      style={{
                        fontSize: 11,
                        fontWeight: 500,
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--muted-foreground)",
                        cursor: "pointer",
                      }}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}
              {cfDnsAdded && cfDnsAdded.length > 0 && (
                <p className="text-[12px] text-ok">
                  ✓ Cloudflare DNS added: {cfDnsAdded.join(", ")}
                </p>
              )}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="app.example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddVercelDomain();
                  }}
                  className={`${inputCls(false)} flex-1`}
                />
                <button
                  onClick={handleAddVercelDomain}
                  disabled={!newDomain.trim() || addingDomain}
                  className="px-2.5 py-1.5 rounded-lg bg-secondary text-muted-foreground hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center"
                >
                  {addingDomain ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Plus size={11} />
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
