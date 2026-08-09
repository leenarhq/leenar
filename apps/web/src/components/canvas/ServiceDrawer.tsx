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

  const accentMap: Record<string, string> = {
    trigger: "text-tertiary",
    service: "text-action",
    logic: "text-logic",
    department: "text-canvas-secondary",
  };
  const bgMap: Record<string, string> = {
    trigger: "bg-tertiary/10",
    service: "bg-action/10",
    logic: "bg-logic/10",
    department: "bg-canvas-secondary/10",
  };

  const tabs = serviceDrawerTabs(provider, isProvisioned);

  return (
    <motion.aside
      initial={{ x: 24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 24, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      className="pointer-events-auto absolute right-3 top-3 bottom-3 z-[60] flex w-[400px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-surface-container-low shadow-2xl"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`p-1.5 rounded-lg ${bgMap[node.type] ?? "bg-white/5"}`}
          >
            <IconRenderer
              iconName={
                localData.iconName || (node.type === "trigger" ? "Zap" : "Box")
              }
              className={accentMap[node.type] ?? "text-white/50"}
            />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white/90 leading-tight truncate">
              {localData.label}
            </h3>
            <p className="text-[11px] text-white/30 uppercase tracking-widest">
              {provider || node.type}
            </p>
          </div>
          {isProvisioned && (
            <div className="ml-auto flex items-center gap-1 bg-emerald-500/12 border border-emerald-500/25 rounded-full px-2 py-0.5 flex-shrink-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                Live
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-white/40 hover:text-white/90 hover:bg-white/5"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </header>

      {/* Tab bar */}
      <div className="flex gap-4 border-b border-white/10 px-4 pt-2.5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`pb-2 text-[12px] font-medium transition-colors ${
              activeTab === t
                ? "border-b-2 border-white/80 text-white/90"
                : "text-white/35 hover:text-white/60"
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
      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg bg-white/3 border border-white/8 hover:bg-white/5 hover:border-white/12 transition-all group"
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
      <span className="text-[12px] font-mono text-white/40 group-hover:text-white/60 transition-colors truncate flex-1">
        {hostname}
      </span>
      <IconRenderer
        iconName="ExternalLink"
        size={9}
        className="text-white/25 group-hover:text-white/50 transition-colors flex-shrink-0"
      />
    </a>
  );
}
