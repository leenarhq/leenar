import { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { GitHubRepo, GitHubBranch, ResendDomain } from "../../../lib/api";
import { listGitHubBranches } from "../../../lib/api";
import { IconRenderer, Field, inputCls } from "../Sidebar";

const SUPABASE_REGIONS = [
  { value: "us-east-1", label: "US East (N. Virginia)" },
  { value: "us-west-1", label: "US West (N. California)" },
  { value: "eu-central-1", label: "EU (Frankfurt)" },
  { value: "eu-west-1", label: "EU (Ireland)" },
  { value: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
  { value: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
];

interface SettingsTabProps {
  node: any;
  onClose: () => void;
  onUpdateNode: (id: string, data: any) => void;
  localData: any;
  setLocalData: (data: any) => void;
  handleUpdate: (field: string, value: any) => void;
  isProvisioned: boolean;
  session?: import("@supabase/supabase-js").Session | null;
  onGitHubRepos?: () => Promise<GitHubRepo[]>;
  onResendDomains?: () => Promise<ResendDomain[]>;
  connectedGithub?: boolean;
  connectedResend?: boolean;
  validationErrors: Record<string, string>;
  projectId?: string;
}

export function SettingsTab({
  node,
  onClose,
  onUpdateNode,
  localData,
  setLocalData,
  handleUpdate,
  isProvisioned,
  session,
  onGitHubRepos,
  onResendDomains,
  connectedGithub,
  connectedResend,
  validationErrors,
  projectId,
}: SettingsTabProps) {
  const provider = localData.provider;

  // GitHub repo state
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[] | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const repoFetchedRef = useRef(false);

  // GitHub branch state
  const [branches, setBranches] = useState<GitHubBranch[] | null>(null);
  const [branchLoading, setBranchLoading] = useState(false);
  const lastFetchedRepoRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      node?.data?.provider !== "vercel" ||
      !onGitHubRepos ||
      !connectedGithub ||
      repoFetchedRef.current
    )
      return;
    repoFetchedRef.current = true;
    setRepoLoading(true);
    onGitHubRepos()
      .then(setGithubRepos)
      .catch((err) =>
        setRepoError(
          err instanceof Error ? err.message : "Failed to load repos",
        ),
      )
      .finally(() => setRepoLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.data?.provider, connectedGithub]);

  // Fetch branches when repo changes (fall back to node.data if localData not yet synced)
  useEffect(() => {
    const rawRepo =
      (localData.existing_repo as string | undefined) ||
      (node?.data?.existing_repo as string | undefined);
    if (!rawRepo || !session) {
      setBranches(null);
      return;
    }
    const repoFull = rawRepo
      .replace(/^https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "")
      .replace(/#.*$/, "")
      .trim();
    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(repoFull)) return;
    if (lastFetchedRepoRef.current === repoFull) return;
    lastFetchedRepoRef.current = repoFull;
    setBranchLoading(true);
    listGitHubBranches(repoFull, session)
      .then(setBranches)
      .catch(() => setBranches(null))
      .finally(() => setBranchLoading(false));
  }, [localData.existing_repo, node?.data?.existing_repo, session]);

  // Reset fetch ref when the selected node changes so a fresh fetch happens per node
  useEffect(() => {
    lastFetchedRepoRef.current = null;
    setBranches(null);
  }, [node?.id]);

  const extractDomain = (email: string) => {
    if (!email.includes("@")) return "";
    const d = email.split("@")[1];
    return d?.includes(".") ? d : "";
  };

  // Resend domain state (Supabase node's "Auth Email Sender" via Resend)
  const [resendDomains, setResendDomains] = useState<ResendDomain[] | null>(
    null,
  );
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [resendNotConnected, setResendNotConnected] = useState(false);
  const domainFetchedRef = useRef(false);

  const fetchResendDomains = async () => {
    if (!onResendDomains || domainFetchedRef.current) return;
    domainFetchedRef.current = true;
    setDomainLoading(true);
    setDomainError(null);
    try {
      const domains = await onResendDomains();
      setResendDomains(domains);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load domains";
      if (msg.toLowerCase().includes("no resend connection")) {
        setResendNotConnected(true);
      } else {
        setDomainError(msg);
      }
    } finally {
      setDomainLoading(false);
    }
  };

  // Reset fetch ref when the selected node changes so a fresh fetch happens per node
  useEffect(() => {
    domainFetchedRef.current = false;
    setResendDomains(null);
    setDomainError(null);
    setResendNotConnected(false);
  }, [node?.id]);

  // Load domains when a Supabase node has a Resend edge
  useEffect(() => {
    if (node?.data?.provider !== "supabase" || !connectedResend) return;
    fetchResendDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id, node?.data?.provider, connectedResend]);

  if (!node) return null;

  const effectiveRepo =
    (localData.existing_repo as string | undefined) ||
    (node?.data?.existing_repo as string | undefined) ||
    "";

  return (
    <div className="space-y-4">
      {/* ── Vercel ── */}
      {provider === "vercel" && (
        <>
          {connectedGithub ? (
            <>
              <Field
                label="GitHub Repository"
                hint="Link a GitHub repo so Vercel auto-deploys on every push to main/master."
              >
                {repoLoading ? (
                  <div className="flex items-center gap-1.5 text-dim text-[12px] py-2">
                    <Loader2 size={11} className="animate-spin" />
                    <span>Loading repos…</span>
                  </div>
                ) : githubRepos && githubRepos.length > 0 ? (
                  <select
                    value={effectiveRepo}
                    onChange={(e) => {
                      const repo = e.target.value;
                      const next = {
                        ...localData,
                        existing_repo: repo,
                        branch: "",
                      };
                      setLocalData(next);
                      if (node)
                        onUpdateNode(node.id, {
                          existing_repo: repo,
                          branch: "",
                        });
                      lastFetchedRepoRef.current = null;
                      setBranches(null);
                    }}
                    className={inputCls(false)}
                  >
                    <option value="">Select a repository…</option>
                    {githubRepos.map((r) => (
                      <option key={r.id} value={r.html_url}>
                        {r.full_name}
                        {r.private ? " 🔒" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    {repoError && (
                      <p className="text-[11px] text-crit mb-1">{repoError}</p>
                    )}
                    <input
                      type="text"
                      placeholder="https://github.com/user/repo"
                      value={effectiveRepo}
                      onChange={(e) => {
                        const repo = e.target.value;
                        const next = {
                          ...localData,
                          existing_repo: repo,
                          branch: "",
                        };
                        setLocalData(next);
                        if (node)
                          onUpdateNode(node.id, {
                            existing_repo: repo,
                            branch: "",
                          });
                        lastFetchedRepoRef.current = null;
                        setBranches(null);
                      }}
                      className={`${inputCls(false)} font-mono`}
                    />
                  </>
                )}
              </Field>

              {/* Branch selector — only when a repo is linked */}
              {effectiveRepo && (
                <Field
                  label="Deploy Branch"
                  hint="Which branch Vercel deploys to production. Leave blank to use the repo's default branch."
                >
                  {branchLoading ? (
                    <div className="flex items-center gap-1.5 text-dim text-[12px] py-2">
                      <Loader2 size={11} className="animate-spin" />
                      <span>Loading branches…</span>
                    </div>
                  ) : branches && branches.length > 0 ? (
                    <select
                      value={localData.branch || ""}
                      onChange={(e) => handleUpdate("branch", e.target.value)}
                      className={inputCls(false)}
                    >
                      <option value="">Default branch</option>
                      {branches.map((b) => (
                        <option key={b.name} value={b.name}>
                          {b.name}
                          {b.protected ? " 🔒" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="main"
                      value={localData.branch || ""}
                      onChange={(e) => handleUpdate("branch", e.target.value)}
                      className={`${inputCls(false)} font-mono`}
                    />
                  )}
                </Field>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg bg-[var(--hover)] border border-border-soft text-[12px] text-dim">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                fill="currentColor"
                className="flex-shrink-0"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Connect a GitHub node to select a repository
            </div>
          )}
          <Field
            label="Project Name"
            hint="Lowercase letters, numbers, hyphens only. Max 100 chars. Becomes your default Vercel URL: my-project.vercel.app"
          >
            <input
              type="text"
              placeholder="my-awesome-app"
              value={localData.projectName || ""}
              onChange={(e) => handleUpdate("projectName", e.target.value)}
              disabled={isProvisioned}
              className={`${inputCls(isProvisioned)} ${validationErrors.projectName ? "border-destructive/60 focus:ring-destructive/30" : ""}`}
            />
            {validationErrors.projectName && (
              <p className="text-xs text-destructive">
                {validationErrors.projectName}
              </p>
            )}
          </Field>
        </>
      )}

      {/* ── Supabase: Tables ── */}
      {provider === "supabase" && (
        <>
          <p className="px-1 pt-1 font-mono text-[10px] lowercase text-dim">
            Tables
          </p>
          <div className="rounded-lg bg-[var(--hover)] border border-border-soft p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span>
                {(localData.tables ?? []).length} table
                {(localData.tables ?? []).length === 1 ? "" : "s"} ·{" "}
                {(localData.tables ?? []).reduce(
                  (n: number, t: any) => n + (t.columns?.length ?? 0),
                  0,
                )}{" "}
                column
                {(localData.tables ?? []).reduce(
                  (n: number, t: any) => n + (t.columns?.length ?? 0),
                  0,
                ) === 1
                  ? ""
                  : "s"}
              </span>
              {localData.supabaseProjectRef ? (
                <span className="inline-flex items-center rounded-full border border-ok/30 px-2 py-0.5 font-mono text-[10px] lowercase text-ok">
                  Provisioned
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase text-muted-foreground">
                  Draft
                </span>
              )}
            </div>
            {projectId ? (
              <Link
                to="/console/projects/$id/database"
                params={{ id: projectId }}
                search={{ node: node.id }}
                className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-[var(--hover)] border border-border text-foreground text-[12px] font-semibold hover:bg-secondary transition-all"
              >
                Manage in Database →
              </Link>
            ) : (
              <p className="text-[11px] text-dim">
                Save the project to manage tables in the Database Workspace.
              </p>
            )}
          </div>
        </>
      )}

      {/* ── Supabase: Region ── */}
      {provider === "supabase" && (
        <Field
          label="Region"
          hint="Where your Supabase database is hosted. eu-central-1 and eu-west-1 keep data in the EU (GDPR). Cannot be changed after creation."
        >
          <select
            value={localData.region || "us-east-1"}
            onChange={(e) => handleUpdate("region", e.target.value)}
            disabled={isProvisioned}
            className={inputCls(isProvisioned)}
          >
            {SUPABASE_REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* ── Supabase: Email Delivery via Resend ── */}
      {provider === "supabase" && (
        <>
          <p className="px-1 pt-1 font-mono text-[10px] lowercase text-dim">
            Email Delivery
          </p>
          {!connectedResend ? (
            <div className="flex items-center gap-2 px-2.5 py-2.5 rounded-lg bg-[var(--hover)] border border-border-soft text-[12px] text-dim">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="flex-shrink-0"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Connect a Resend node to configure email delivery
            </div>
          ) : resendNotConnected ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-[var(--hover)] px-3 py-3">
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                Connect{" "}
                <span className="text-muted-foreground font-semibold">
                  Resend
                </span>{" "}
                to send auth emails from your own domain.
              </p>
              <a
                href="/console/integrations"
                className="inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[var(--hover)] border border-border text-foreground text-[11px] font-semibold hover:bg-secondary transition-all"
              >
                Connect Resend →
              </a>
            </div>
          ) : (
            <Field
              label="Auth Email Sender"
              hint="Override Supabase's default auth email sender. Uses a verified domain from your Resend account (e.g. noreply@yourdomain.com)."
            >
              {domainLoading ? (
                <div className="flex items-center gap-1.5 text-dim text-[12px] py-2">
                  <Loader2 size={11} className="animate-spin" />
                  <span>Loading domains…</span>
                </div>
              ) : domainError ? (
                <p className="text-[11px] text-crit">{domainError}</p>
              ) : resendDomains !== null && resendDomains.length === 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-dim">
                    No verified domains in your Resend account.
                  </p>
                  <a
                    href="https://resend.com/domains"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Add & verify a domain in Resend →
                  </a>
                </div>
              ) : (
                <>
                  <select
                    value={extractDomain(localData.fromEmail ?? "")}
                    onChange={(e) => {
                      const d = e.target.value;
                      const prefix =
                        localData.fromEmail?.split("@")[0] || "noreply";
                      handleUpdate("fromEmail", d ? `${prefix}@${d}` : "");
                    }}
                    className={inputCls(false)}
                  >
                    <option value="">
                      No custom sender (use Supabase default)
                    </option>
                    {resendDomains?.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  {isProvisioned && (
                    <p className="text-[11px] text-warn mt-1">
                      Changes apply on next deploy
                    </p>
                  )}
                  {extractDomain(localData.fromEmail ?? "") && (
                    <>
                      <input
                        type="text"
                        placeholder="noreply"
                        value={localData.fromEmail?.split("@")[0] || ""}
                        onChange={(e) => {
                          const domain = extractDomain(
                            localData.fromEmail ?? "",
                          );
                          handleUpdate(
                            "fromEmail",
                            `${e.target.value}@${domain}`,
                          );
                        }}
                        className={`${inputCls(false)} font-mono mt-1`}
                      />
                      <input
                        type="text"
                        placeholder="My App"
                        value={localData.senderName || ""}
                        onChange={(e) =>
                          handleUpdate("senderName", e.target.value)
                        }
                        className={`${inputCls(false)} mt-1`}
                      />
                      <p className="text-[11px] text-dim mt-1 font-mono">
                        {localData.senderName || "My App"} &lt;
                        {localData.fromEmail}&gt;
                      </p>
                    </>
                  )}
                </>
              )}
            </Field>
          )}
        </>
      )}

      {/* ── Cloudflare ── */}
      {provider === "cloudflare" && (
        <>
          <p className="px-1 pt-1 font-mono text-[10px] lowercase text-dim">
            Cloudflare Service
          </p>
          <Field
            label="Service"
            hint="Choose which Cloudflare service to provision."
          >
            <select
              value={localData.cloudflareService || "workers"}
              onChange={(e) =>
                handleUpdate("cloudflareService", e.target.value)
              }
              disabled={isProvisioned}
              className={inputCls(isProvisioned)}
            >
              <option value="workers">Workers — serverless compute</option>
              <option value="r2">R2 — object storage (S3-compatible)</option>
            </select>
          </Field>

          {/* ── Workers config ── */}
          {(localData.cloudflareService === "workers" ||
            !localData.cloudflareService) && (
            <>
              <Field
                label="Worker Name"
                hint="Becomes {name}.workers.dev — lowercase, numbers, hyphens only."
              >
                <input
                  type="text"
                  placeholder="my-worker"
                  value={localData.cfWorkerName || ""}
                  onChange={(e) => handleUpdate("cfWorkerName", e.target.value)}
                  disabled={isProvisioned}
                  className={`${inputCls(isProvisioned)} ${validationErrors.cfWorkerName ? "border-destructive/60 focus:ring-destructive/30" : ""}`}
                />
                {validationErrors.cfWorkerName && (
                  <p className="text-xs text-destructive">
                    {validationErrors.cfWorkerName}
                  </p>
                )}
              </Field>
              <Field
                label="Compatibility Date"
                hint="Workers runtime version. Older date = more stable; newer = latest APIs."
              >
                <input
                  type="date"
                  value={
                    (localData.compatibilityDate as string) ||
                    new Date().toISOString().slice(0, 10)
                  }
                  onChange={(e) =>
                    handleUpdate("compatibilityDate", e.target.value)
                  }
                  disabled={isProvisioned}
                  className={inputCls(isProvisioned)}
                />
              </Field>
            </>
          )}

          {/* ── R2 config ── */}
          {localData.cloudflareService === "r2" && (
            <>
              <Field
                label="Bucket Name"
                hint="Lowercase letters, numbers, hyphens. Unique within your account."
              >
                <input
                  type="text"
                  placeholder="my-bucket"
                  value={localData.cfBucketName || ""}
                  onChange={(e) => handleUpdate("cfBucketName", e.target.value)}
                  disabled={isProvisioned}
                  className={`${inputCls(isProvisioned)} ${validationErrors.cfBucketName ? "border-destructive/60 focus:ring-destructive/30" : ""}`}
                />
                {validationErrors.cfBucketName && (
                  <p className="text-xs text-destructive">
                    {validationErrors.cfBucketName}
                  </p>
                )}
              </Field>
              <Field
                label="Location Hint"
                hint="Geographic region for the bucket. Auto lets Cloudflare decide."
              >
                <select
                  value={(localData.cfLocationHint as string) || ""}
                  onChange={(e) =>
                    handleUpdate("cfLocationHint", e.target.value)
                  }
                  disabled={isProvisioned}
                  className={inputCls(isProvisioned)}
                >
                  <option value="">Auto (recommended)</option>
                  <option value="wnam">Western North America</option>
                  <option value="enam">Eastern North America</option>
                  <option value="weur">Western Europe</option>
                  <option value="eeur">Eastern Europe</option>
                  <option value="apac">Asia Pacific</option>
                </select>
              </Field>
            </>
          )}

          {/* ── Cloudflare: Post-provisioning info ── */}
          {isProvisioned && (
            <div className="space-y-2 pt-1">
              {/* Worker URL */}
              {localData.cfWorkerNameProvisioned &&
                localData.cloudflareWorkerUrl && (
                  <a
                    href={localData.cloudflareWorkerUrl as string}
                    target="_blank"
                    rel="noopener noreferrer"
                    // Cloudflare's #F4811F used to tint the fill, the border
                    // and the ink here. Opening a Worker is an action, not a
                    // state, and the provider it belongs to is already named
                    // by the node this drawer is attached to — so it takes the
                    // console's neutral button rather than a brand hue.
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-secondary"
                  >
                    <IconRenderer iconName="ExternalLink" size={11} />
                    Open Worker
                  </a>
                )}
              <div className="rounded-lg bg-[var(--hover)] border border-border-soft divide-y divide-border-soft">
                {localData.cfWorkerNameProvisioned && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[11px] text-dim shrink-0">
                      Worker
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {localData.cfWorkerNameProvisioned as string}
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          localData.cfWorkerNameProvisioned as string,
                        )
                      }
                      className="text-dim hover:text-muted-foreground transition-colors shrink-0"
                      title="Copy"
                    >
                      <IconRenderer iconName="Copy" size={11} />
                    </button>
                  </div>
                )}
                {localData.cfBucketNameProvisioned && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[11px] text-dim shrink-0">
                      Bucket
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {localData.cfBucketNameProvisioned as string}
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          localData.cfBucketNameProvisioned as string,
                        )
                      }
                      className="text-dim hover:text-muted-foreground transition-colors shrink-0"
                      title="Copy"
                    >
                      <IconRenderer iconName="Copy" size={11} />
                    </button>
                  </div>
                )}
                {localData.cloudflareWorkerUrl && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[11px] text-dim shrink-0">URL</span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {localData.cloudflareWorkerUrl as string}
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          localData.cloudflareWorkerUrl as string,
                        )
                      }
                      className="text-dim hover:text-muted-foreground transition-colors shrink-0"
                      title="Copy"
                    >
                      <IconRenderer iconName="Copy" size={11} />
                    </button>
                  </div>
                )}
                {localData.r2Endpoint && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[11px] text-dim shrink-0">
                      Endpoint
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {localData.r2Endpoint as string}
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          localData.r2Endpoint as string,
                        )
                      }
                      className="text-dim hover:text-muted-foreground transition-colors shrink-0"
                      title="Copy"
                    >
                      <IconRenderer iconName="Copy" size={11} />
                    </button>
                  </div>
                )}
                {localData.cloudflareAccountId && (
                  <div className="flex items-center justify-between px-3 py-2 gap-2">
                    <span className="text-[11px] text-dim shrink-0">
                      Account
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground truncate">
                      {localData.cloudflareAccountId as string}
                    </span>
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          localData.cloudflareAccountId as string,
                        )
                      }
                      className="text-dim hover:text-muted-foreground transition-colors shrink-0"
                      title="Copy"
                    >
                      <IconRenderer iconName="Copy" size={11} />
                    </button>
                  </div>
                )}
              </div>

              {/* Injected env vars info */}
              <div className="rounded-lg bg-[var(--hover)] border border-border-soft p-3 space-y-1">
                <p className="mb-1.5 font-mono text-[10px] lowercase text-dim">
                  Injected into Vercel
                </p>
                {(localData.cloudflareService === "workers" ||
                  !localData.cloudflareService) && (
                  <>
                    {[
                      "CLOUDFLARE_WORKER_URL",
                      "CLOUDFLARE_WORKER_NAME",
                      "CLOUDFLARE_ACCOUNT_ID",
                    ].map((k) => (
                      <p key={k} className="text-[11px] font-mono text-dim">
                        {k}
                      </p>
                    ))}
                  </>
                )}
                {localData.cloudflareService === "r2" && (
                  <>
                    {[
                      "R2_BUCKET_NAME",
                      "R2_ENDPOINT",
                      "R2_ACCESS_KEY_ID",
                      "R2_SECRET_ACCESS_KEY",
                    ].map((k) => (
                      <p key={k} className="text-[11px] font-mono text-dim">
                        {k}
                      </p>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Description — always shown */}
      <Field label="Description">
        <textarea
          rows={2}
          value={localData.description || ""}
          onChange={(e) => handleUpdate("description", e.target.value)}
          className="w-full bg-secondary border border-border rounded-lg py-1.5 px-3 text-foreground focus:border-foreground/30 outline-none resize-none transition-all text-[13px]"
        />
      </Field>

      <div className="p-3 bg-[var(--hover)] border border-border-soft rounded-xl">
        <p className="mb-1.5 font-mono text-[10px] lowercase text-dim">Node</p>
        <p className="text-[11px] font-mono text-primary/50">
          id: {node.id.slice(0, 8)}…
        </p>
        <p className="text-[11px] font-mono text-dim">type: {node.type}</p>
        {provider && (
          <p className="text-[11px] font-mono text-dim">provider: {provider}</p>
        )}
      </div>

      {/* Danger Zone */}
      <div className="rounded-xl border border-crit/20 overflow-hidden">
        <div className="border-b border-crit/20 px-3 py-2">
          <p className="font-mono text-[10px] lowercase text-crit">
            Danger Zone
          </p>
        </div>
        <div className="p-3 space-y-2">
          <button
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("leenar:node-menu", {
                  detail: { nodeId: node.id, action: "delete" },
                }),
              );
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-full border border-crit/30 py-1.5 text-[12px] font-medium text-crit transition-colors hover:bg-crit/10"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v6M14 11v6" />
              <path d="M9 6V4h6v2" />
            </svg>
            Delete Node
          </button>
        </div>
      </div>
    </div>
  );
}
