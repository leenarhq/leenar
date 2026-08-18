import React, { useState, useEffect } from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import type {
  ResendDomain,
  ResendDomainRecord,
  GitHubRepo,
  VercelDomain,
} from "../../lib/api";
import { IconRenderer } from "./Sidebar";
import { providerIcon } from "./nodes/providerMeta";
import { StateTag } from "../console/StateTag";
import {
  serviceDrawerTabs,
  TAB_LABELS,
  type TabKey,
} from "../../lib/serviceDrawerTabs";
import { OverviewTab } from "./drawer/OverviewTab";
import { VariablesTab } from "./drawer/VariablesTab";
import { DomainsTab } from "./drawer/DomainsTab";
import { SettingsTab } from "./drawer/SettingsTab";

interface ServiceDrawerProps {
  node: any;
  onClose: () => void;
  onUpdateNode: (id: string, data: any) => void;
  onImportNode?: (
    service: "vercel" | "supabase",
    identifier: string,
  ) => Promise<void>;
  onResendDomains?: () => Promise<ResendDomain[]>;
  onGitHubRepos?: () => Promise<GitHubRepo[]>;
  onVercelDomains?: () => Promise<VercelDomain[]>;
  onAddVercelDomain?: (domain: string) => Promise<VercelDomain>;
  onRemoveVercelDomain?: (domain: string) => Promise<void>;
  onAddCfDns?: (
    domain: VercelDomain,
  ) => Promise<{ added: string[]; skipped: string[] }>;
  onCreateResendDomain?: (name: string) => Promise<ResendDomain>;
  onResendDomainRecords?: (domainId: string) => Promise<ResendDomainRecord[]>;
  onDeleteResendDomain?: (domainId: string) => Promise<void>;
  connectedGithub?: boolean;
  connectedResend?: boolean;
  workflowId?: string;
  projectId?: string;
  currentEnvId?: string | null;
  session?: import("@supabase/supabase-js").Session | null;
  onRedeploy?: (nodeId: string) => Promise<void>;
}

export function ServiceDrawer(props: ServiceDrawerProps) {
  const {
    node,
    onClose,
    onUpdateNode,
    onImportNode,
    onResendDomains,
    onGitHubRepos,
    onVercelDomains,
    onAddVercelDomain,
    onRemoveVercelDomain,
    onAddCfDns,
    onCreateResendDomain,
    onResendDomainRecords,
    onDeleteResendDomain,
    connectedGithub,
    connectedResend,
    workflowId,
    projectId,
    currentEnvId,
    session,
    onRedeploy,
  } = props;

  // ── hoisted node-detail state (moved verbatim from Sidebar.tsx) ──
  const [localData, setLocalData] = useState<any>(node?.data ?? {});

  // ── Tab bar state ──────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabKey>(
    () =>
      serviceDrawerTabs(
        (node?.data?.provider as string) ?? "",
        node?.data?.status === "provisioned",
      )[0],
  );
  useEffect(() => {
    setActiveTab(
      serviceDrawerTabs(
        (node?.data?.provider as string) ?? "",
        node?.data?.status === "provisioned",
      )[0],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node?.id]);

  // ── Inline validation ──────────────────────────────────────────
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  const VERCEL_NAME_RE = /^[a-z0-9-]{1,100}$/;
  const CF_WORKER_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;
  const R2_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

  const validateField = (field: string, value: string): string => {
    if (field === "projectName") {
      if (!value) return "";
      if (!VERCEL_NAME_RE.test(value))
        return "Lowercase letters, numbers, hyphens only (1–100 chars).";
      if (value.startsWith("-") || value.endsWith("-"))
        return "Cannot start or end with a hyphen.";
    }
    if (field === "cfWorkerName") {
      if (!value) return "";
      if (!CF_WORKER_RE.test(value))
        return "Lowercase letters, numbers, hyphens. Max 64 chars. Cannot start or end with a hyphen.";
    }
    if (field === "cfBucketName") {
      if (!value) return "";
      if (!R2_BUCKET_RE.test(value))
        return "Lowercase letters, numbers, hyphens. 3–63 chars. Cannot start or end with a hyphen.";
    }
    return "";
  };

  const handleUpdate = (field: string, value: any) => {
    const next = { ...localData, [field]: value };
    setLocalData(next);
    if (node) onUpdateNode(node.id, { [field]: value });
    if (
      field === "projectName" ||
      field === "cfWorkerName" ||
      field === "cfBucketName"
    ) {
      const err = validateField(field, typeof value === "string" ? value : "");
      setValidationErrors((prev) => ({ ...prev, [field]: err }));
    }
  };

  const hasValidationError = Object.values(validationErrors).some(Boolean);

  if (!node) return null;

  const provider = localData.provider ?? "";
  const isProvisioned = localData.status === "provisioned";

  const tabs = serviceDrawerTabs(provider, isProvisioned);

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      // bg-popover, not bg-card or a translucent glass: the drawer sits over
      // the canvas and has to be opaque, or the nodes read straight through it.
      className="pointer-events-auto absolute right-3 top-3 bottom-3 z-[60] flex w-[400px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border-soft bg-popover shadow-[var(--raise-lg)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-border text-foreground">
            {provider ? (
              providerIcon(provider)
            ) : (
              <IconRenderer
                iconName={
                  localData.iconName ||
                  (node.type === "trigger" ? "Zap" : "Box")
                }
                size={15}
              />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] font-medium leading-tight tracking-[-0.01em]">
              {localData.label}
            </h3>
            <p className="mt-px truncate font-mono text-[10.5px] lowercase text-muted-foreground">
              {provider || node.type}
            </p>
          </div>
          {isProvisioned && (
            <span className="ml-auto shrink-0">
              <StateTag tone="ok" label="live" dot />
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex gap-4 border-b border-border px-4 pt-2.5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`-mb-px border-b pb-2 text-[12px] transition-colors ${
              activeTab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-[13px]">
        {activeTab === "overview" && (
          <OverviewTab
            node={node}
            localData={localData}
            handleUpdate={handleUpdate}
            isProvisioned={isProvisioned}
            onRedeploy={onRedeploy}
          />
        )}
        {activeTab === "variables" && (
          <VariablesTab
            node={node}
            localData={localData}
            handleUpdate={handleUpdate}
            isProvisioned={isProvisioned}
            workflowId={workflowId}
            currentEnvId={currentEnvId}
            session={session}
          />
        )}
        {activeTab === "domains" && (
          <DomainsTab
            node={node}
            localData={localData}
            isProvisioned={isProvisioned}
            onVercelDomains={onVercelDomains}
            onAddVercelDomain={onAddVercelDomain}
            onRemoveVercelDomain={onRemoveVercelDomain}
            onAddCfDns={onAddCfDns}
            onResendDomains={onResendDomains}
            onCreateResendDomain={onCreateResendDomain}
            onResendDomainRecords={onResendDomainRecords}
            onDeleteResendDomain={onDeleteResendDomain}
          />
        )}
        {activeTab === "settings" && (
          <SettingsTab
            node={node}
            onClose={onClose}
            onUpdateNode={onUpdateNode}
            localData={localData}
            setLocalData={setLocalData}
            handleUpdate={handleUpdate}
            isProvisioned={isProvisioned}
            session={session}
            onGitHubRepos={onGitHubRepos}
            onResendDomains={onResendDomains}
            connectedGithub={connectedGithub}
            connectedResend={connectedResend}
            validationErrors={validationErrors}
            projectId={projectId}
          />
        )}
      </div>
    </motion.aside>
  );
}

// ── Helpers (moved verbatim from Sidebar.tsx, used only by the moved body) ──

export function LivePreview({ url }: { url: string }) {
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex w-full items-center gap-2.5 rounded-lg border border-border-soft px-3 py-2 transition-colors hover:border-border hover:bg-[var(--hover)]"
    >
      {/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(hostname) && (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`}
          alt=""
          width={14}
          height={14}
          className="rounded-sm opacity-70 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <span className="flex-1 truncate font-mono text-[12px] text-muted-foreground transition-colors group-hover:text-foreground">
        {hostname}
      </span>
      <IconRenderer
        iconName="ExternalLink"
        size={9}
        className="shrink-0 text-dim transition-colors group-hover:text-muted-foreground"
      />
    </a>
  );
}
