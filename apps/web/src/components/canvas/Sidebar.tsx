import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { track } from "../../lib/monitoring";
import type {
  ResendDomain,
  ResendDomainRecord,
  GitHubRepo,
  VercelDomain,
} from "../../lib/api";
import * as LucideIcons from "lucide-react";

interface SidebarProps {
  node: any;
  onClose: () => void;
  onAddNode: (type: string, data: any) => void;
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
  currentEnvId?: string | null;
  session?: import("@supabase/supabase-js").Session | null;
  onRedeploy?: (nodeId: string) => Promise<void>;
}

const CloudflareSvg = ({
  size,
  className,
  style,
}: {
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 120"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <path
      d="M202.357,51.394 L197.046,49.27 C172.085,105.434 72.786,71.289 66.811,87.997 C65.815,99.283 121.038,90.143 160.517,92.056 C172.556,92.639 178.593,101.727 173.481,116.54 L183.55,116.571 C195.165,80.362 232.233,98.841 233.782,86.891 C231.237,79.034 191.181,86.891 202.357,51.394 Z"
      fill="#FFFFFF"
    />
    <path
      d="M176.332,110.348 C177.925,105.037 177.394,99.726 174.739,96.539 C172.083,93.352 168.365,91.228 163.585,90.697 L71.17,89.634 C70.639,89.634 70.108,89.103 69.577,89.103 C69.046,88.572 69.046,88.041 69.577,87.51 C70.108,86.448 70.639,85.916 71.701,85.916 L164.647,84.854 C175.801,84.323 187.486,75.294 191.734,64.672 L197.046,50.863 C197.046,50.331 197.577,49.8 197.046,49.269 C191.203,22.182 166.772,1.999 138.091,1.999 C111.535,1.999 88.697,18.995 80.73,42.896 C75.419,39.178 69.046,37.053 61.61,37.585 C48.863,38.647 38.772,49.269 37.178,62.016 C36.647,65.203 37.178,68.39 37.71,71.576 C16.996,72.107 0,89.103 0,110.348 C0,112.472 0,114.066 0.531,116.19 C0.531,117.253 1.593,117.784 2.125,117.784 L172.614,117.784 C173.676,117.784 174.739,117.253 174.739,116.19 L176.332,110.348 Z"
      fill="#F4811F"
    />
    <path
      d="M205.544,50.863 L202.888,50.863 C202.357,50.863 201.826,51.394 201.295,51.925 L197.577,64.672 C195.984,69.983 196.515,75.295 199.171,78.481 C201.826,81.668 205.544,83.792 210.324,84.323 L229.976,85.386 C230.507,85.386 231.038,85.917 231.569,85.917 C232.1,86.448 232.1,86.979 231.569,87.51 C231.038,88.573 230.507,89.104 229.444,89.104 L209.262,90.166 C198.108,90.697 186.424,99.726 182.175,110.348 L181.112,115.129 C180.581,115.66 181.112,116.722 182.175,116.722 L252.283,116.722 C253.345,116.722 253.876,116.191 253.876,115.129 C254.938,110.88 256,106.1 256,101.319 C256,73.701 233.162,50.863 205.544,50.863"
      fill="#FAAD3F"
    />
  </svg>
);

export const IconRenderer = ({
  iconName,
  className,
  size = 13,
  style,
}: {
  iconName: string;
  className?: string;
  size?: number;
  style?: React.CSSProperties;
}) => {
  if (iconName === "Cloudflare")
    return <CloudflareSvg size={size} className={className} style={style} />;
  const Icon = (LucideIcons as any)[iconName] || LucideIcons.Box;
  return <Icon className={className} size={size} style={style} />;
};

const CORE_SERVICES = [
  {
    id: "github",
    label: "GitHub",
    icon: "Github",
    color: "#e2e8f0",
    desc: "Source code & version control",
  },
  {
    id: "vercel",
    label: "Vercel",
    icon: "Triangle",
    color: "#c8503a",
    desc: "Frontend cloud platform",
  },
  {
    id: "supabase",
    label: "Supabase",
    icon: "Database",
    color: "#22c55e",
    desc: "Database & Auth",
  },
  {
    id: "resend",
    label: "Resend",
    icon: "Send",
    color: "#a78bfa",
    desc: "Transactional email",
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    icon: "Cloudflare",
    color: "#f6821f",
    desc: "Workers & R2 storage",
  },
];

export function Sidebar({
  node,
  onClose,
  onAddNode,
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
  currentEnvId,
  session,
  onRedeploy,
}: SidebarProps) {
  // Each node gets its own Sidebar instance (key={node.id} in parent), so
  // initialising from node.data once is safe — no stale state between nodes.
  const [importService, setImportService] = useState<"vercel" | "supabase">(
    "vercel",
  );
  const [importId, setImportId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!importId.trim() || importing || !onImportNode) return;
    setImporting(true);
    setImportError(null);
    try {
      await onImportNode(importService, importId.trim());
      setImportId("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const renderAdd = () => (
    <div className="flex-1 overflow-y-auto p-3 space-y-4 text-[13px]">
      <div className="space-y-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/25 px-1">
          Infrastructure
        </p>
        <div className="space-y-1.5">
          {CORE_SERVICES.map((svc) => (
            <button
              key={svc.id}
              onClick={() => {
                track("node_added", { provider: svc.id });
                onAddNode("service", {
                  label: svc.label,
                  iconName: svc.icon,
                  provider: svc.id,
                  description: svc.desc,
                });
              }}
              className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/[0.05] bg-surface-container/20 hover:bg-surface-container/50 hover:border-white/[0.12] transition-all text-left"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={
                  svc.id === "vercel"
                    ? {
                        background:
                          "color-mix(in srgb, var(--app-accent) 8%, transparent)",
                        border:
                          "1px solid color-mix(in srgb, var(--app-accent) 18%, transparent)",
                      }
                    : {
                        background: `${svc.color}12`,
                        border: `1px solid ${svc.color}25`,
                      }
                }
              >
                <IconRenderer
                  iconName={svc.icon}
                  size={14}
                  className="text-current"
                  style={
                    {
                      color:
                        svc.id === "vercel" ? "var(--app-accent)" : svc.color,
                    } as any
                  }
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[13px] font-semibold text-white/90 leading-tight block">
                  {svc.label}
                </span>
                <p className="text-[11px] text-white/30 leading-tight truncate mt-0.5">
                  {svc.desc}
                </p>
              </div>
              <Plus
                size={12}
                className="flex-shrink-0 text-white/20 opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>
          ))}
        </div>
      </div>

      {/* Import existing */}
      {onImportNode && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/25 px-1">
            Import Existing
          </p>
          <div className="space-y-2 p-3 rounded-xl border border-white/[0.05] bg-surface-container/10">
            <select
              value={importService}
              onChange={(e) => {
                setImportService(e.target.value as "vercel" | "supabase");
                setImportError(null);
              }}
              className="w-full bg-surface-container/30 border border-white/[0.08] rounded-lg px-2 py-1.5 text-[12px] text-white/70 outline-none appearance-none cursor-pointer"
            >
              <option value="vercel">Vercel</option>
              <option value="supabase">Supabase</option>
            </select>
            <input
              type="text"
              value={importId}
              onChange={(e) => {
                setImportId(e.target.value);
                setImportError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleImport();
              }}
              placeholder={
                importService === "vercel"
                  ? "project-name or vercel.com/…"
                  : "abc123 or abc123.supabase.co"
              }
              className="w-full bg-surface-container/30 border border-white/[0.08] rounded-lg px-2 py-1.5 text-[12px] text-white/70 font-mono placeholder:text-white/20 outline-none"
            />
            {importError && (
              <p className="text-[11px] text-red-400/80 leading-tight">
                {importError}
              </p>
            )}
            <button
              onClick={handleImport}
              disabled={importing || !importId.trim()}
              className="w-full py-1.5 rounded-lg bg-action/10 border border-action/20 text-action/80 text-[12px] font-medium hover:bg-action/20 hover:text-action transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return renderAdd();
}

// ── Helpers ────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const openTip = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setTipPos({ top: r.top, left: r.left });
    }
    setShowTip(true);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <label className="text-[11px] text-white/30 uppercase font-bold tracking-widest">
          {label}
        </label>
        {hint && (
          <div className="flex-shrink-0">
            <button
              ref={btnRef}
              className="w-3.5 h-3.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-white/25 hover:text-white/55 hover:bg-white/[0.1] transition-colors flex items-center justify-center"
              onMouseEnter={openTip}
              onMouseLeave={() => setShowTip(false)}
              onFocus={openTip}
              onBlur={() => setShowTip(false)}
              tabIndex={-1}
            >
              <span className="text-[7px] font-bold leading-none">?</span>
            </button>
            {showTip &&
              createPortal(
                <div
                  className="fixed z-[9999] w-[210px] rounded-lg border border-white/[0.1] px-2.5 py-2 shadow-2xl pointer-events-none"
                  style={{
                    background: "var(--app-menu-bg, #0f0f12)",
                    top: tipPos.top,
                    left: tipPos.left,
                    transform: "translateY(calc(-100% - 6px))",
                  }}
                >
                  <p className="text-[11px] text-white/55 leading-relaxed">
                    {hint}
                  </p>
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function inputCls(disabled: boolean) {
  return `w-full bg-surface-container-low border border-white/[0.07] rounded-lg py-1.5 px-3 text-white/85 focus:ring-1 focus:ring-primary/30 outline-none transition-all text-[13px] ${
    disabled ? "opacity-50 cursor-not-allowed" : ""
  }`;
}
