import React, { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { Node, Edge, Viewport } from "@xyflow/react";
import {
  ArrowLeft,
  Zap,
  MessageSquare,
  ExternalLink,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { useAuth } from "../../context/auth";
import { getProject } from "../../lib/workflows";
import type { Project } from "../../lib/workflows";
import { useDeployFlow } from "./hooks/useDeployFlow";
import { SERVICE_DISPLAY } from "./workspaceHelpers";
import { ChatPanelSheet } from "./ChatPanelSheet";
import { PreDeployModal } from "./PreDeployModal";

const SERVICE_ICON: Record<string, string> = {
  github: "Github",
  vercel: "Triangle",
  supabase: "Database",
  resend: "Send",
};

function ProviderIcon({ name, size = 16 }: { name?: string; size?: number }) {
  if (name === "Cloudflare") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 256 120"
        xmlns="http://www.w3.org/2000/svg"
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
  }
  const Icon = name ? (LucideIcons as any)[name] : LucideIcons.Box;
  return <Icon size={size} />;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; color: string; bg: string }> = {
    provisioned: {
      label: "Live",
      color: "#34d399",
      bg: "rgba(52,211,153,0.1)",
    },
    provisioning: {
      label: "Deploying",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.1)",
    },
    error: {
      label: "Error",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.1)",
    },
  };
  const c = config[status];
  if (!c) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "2px 7px",
        borderRadius: 99,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.color}33`,
        flexShrink: 0,
      }}
    >
      {c.label}
    </span>
  );
}

function NodeCard({ node }: { node: Node }) {
  const data = node.data as any;
  const provider = (data.provider as string | undefined)?.toLowerCase();
  const iconName =
    data.iconName ?? (provider ? SERVICE_ICON[provider] : undefined);
  const svc = provider ? SERVICE_DISPLAY[provider] : null;
  const status = data.status as string | undefined;

  const hostname = (() => {
    try {
      return new URL(data.provisionedUrl as string).hostname;
    } catch {
      return data.provisionedUrl as string | undefined;
    }
  })();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
        background: "var(--app-card-bg)",
        border: "1px solid var(--app-border)",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 9,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--app-surface)",
          color: svc?.color ?? "var(--app-text-dim)",
        }}
      >
        <ProviderIcon name={iconName} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{ fontSize: 14, fontWeight: 500, color: "var(--app-text)" }}
          >
            {data.label ?? svc?.label ?? provider ?? "Service"}
          </span>
          {status && <StatusBadge status={status} />}
        </div>
        {hostname && (
          <a
            href={data.provisionedUrl as string}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 5,
              fontSize: 12,
              color: "var(--app-accent-muted)",
              textDecoration: "none",
              fontFamily: "monospace",
              opacity: 0.85,
            }}
          >
            <ExternalLink size={11} />
            {hostname}
          </a>
        )}
        {data.errorMsg && (
          <div
            style={{
              marginTop: 5,
              fontSize: 12,
              color: "#f87171",
              lineHeight: 1.5,
            }}
          >
            {data.errorMsg as string}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
  template?: string;
}

export function ProjectMobileView({ projectId }: Props) {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [showPreDeploy, setShowPreDeploy] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const workflowIdRef = useRef(projectId);
  const workflowNameRef = useRef("Workflow");

  useEffect(() => {
    if (!projectId || projectId === "new") return;
    getProject(projectId)
      .then((wf) => {
        setWorkflow(wf);
        workflowNameRef.current = wf.name;
        setNodes((wf.canvas.nodes ?? []) as Node[]);
        setEdges((wf.canvas.edges ?? []) as Edge[]);
      })
      .catch(() => {
        setLoadError(true);
      });
  }, [projectId]);

  const toObject = useCallback(
    () => ({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 } as Viewport,
    }),
    [nodes, edges],
  );

  const setSaveState = useCallback(() => {}, []);

  const { isRunning, deployError, deployErrorMsg, handleDeployToggle } =
    useDeployFlow({
      session,
      workflowIdRef,
      workflowNameRef,
      setSaveState,
      toObject,
      nodes,
      setNodes,
      setEdges,
      navigate,
      setIsTerminalOpen,
    });

  if (!workflow) {
    return (
      <div
        style={{
          height: "100vh",
          background: "var(--app-bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {loadError ? (
          <>
            <AlertTriangle size={22} style={{ color: "#ef4444" }} />
            <p
              style={{
                fontSize: 14,
                color: "var(--app-text-muted)",
                margin: 0,
              }}
            >
              Failed to load workflow. Please refresh.
            </p>
          </>
        ) : (
          <Loader2
            size={24}
            style={{
              color: "var(--app-text-muted)",
              animation: "spin 1s linear infinite",
            }}
          />
        )}
      </div>
    );
  }

  const wfStatus = workflow.status;
  const statusColors: Record<string, string> = {
    draft: "var(--app-text-muted)",
    active: "#34d399",
    error: "#ef4444",
  };
  const statusLabels: Record<string, string> = {
    draft: "Draft",
    active: "Active",
    error: "Error",
  };

  return (
    <div
      className="app-shell"
      style={{
        height: "100vh",
        background: "var(--app-bg)",
        display: "flex",
        flexDirection: "column",
        color: "var(--app-text)",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Geist', sans-serif",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 16px",
          borderBottom: "1px solid var(--app-border-dim)",
          background: "var(--app-surface)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate({ to: "/console" })}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--app-text-dim)",
            flexShrink: 0,
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--app-text)",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {workflow.name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: statusColors[wfStatus] ?? "var(--app-text-muted)",
              marginTop: 2,
            }}
          >
            {statusLabels[wfStatus] ?? wfStatus}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px 16px 120px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* Stack section */}
        {nodes.length > 0 && (
          <section>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                color: "var(--app-text-muted)",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Stack
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {nodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          </section>
        )}

        {/* Connections section */}
        {edges.length > 0 && (
          <section style={{ marginTop: 28 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.07em",
                color: "var(--app-text-muted)",
                textTransform: "uppercase",
                marginBottom: 10,
              }}
            >
              Connections
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {edges.map((edge) => {
                const src = nodes.find((n) => n.id === edge.source);
                const tgt = nodes.find((n) => n.id === edge.target);
                if (!src || !tgt) return null;

                const envVars = (edge.data as any)?.envVars as
                  | string[]
                  | undefined;

                const srcLabel = (src.data as any).label ?? src.id;
                const tgtLabel = (tgt.data as any).label ?? tgt.id;
                return (
                  <div
                    key={edge.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "9px 12px",
                      borderRadius: 9,
                      background: "var(--app-surface)",
                      border: "1px solid var(--app-border-dim)",
                      gap: 6,
                    }}
                  >
                    <span style={{ color: "var(--app-text)", fontSize: 13 }}>
                      {srcLabel}
                    </span>
                    <span
                      style={{
                        color: "var(--app-text-muted)",
                        fontSize: 11,
                        flexShrink: 0,
                      }}
                    >
                      →
                    </span>
                    <span style={{ color: "var(--app-text)", fontSize: 13 }}>
                      {tgtLabel}
                    </span>
                    {envVars?.length ? (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          color: "#34d399",
                          fontFamily: "monospace",
                          opacity: 0.8,
                          flexShrink: 0,
                        }}
                      >
                        {envVars.length} env var
                        {envVars.length !== 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Deploy error */}
        {deployError && deployErrorMsg && (
          <div
            style={{
              marginTop: 20,
              padding: "12px 14px",
              borderRadius: 10,
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              fontSize: 13,
              color: "#f87171",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
            <span>{deployErrorMsg}</span>
          </div>
        )}

        {/* Empty state */}
        {nodes.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "60px 24px",
              color: "var(--app-text-muted)",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            This workflow has no services yet.
            <br />
            Open on desktop to design your stack.
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 52,
          right: 0,
          display: "flex",
          gap: 10,
          padding: "12px 16px",
          paddingBottom: "calc(max(16px, env(safe-area-inset-bottom)) + 4px)",
          background:
            "linear-gradient(to top, var(--app-bg) 55%, color-mix(in srgb, var(--app-bg) 85%, transparent) 80%, transparent)",
        }}
      >
        <button
          onClick={
            isRunning ? handleDeployToggle : () => setShowPreDeploy(true)
          }
          disabled={nodes.length === 0}
          style={{
            flex: 1,
            height: 50,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 15,
            fontWeight: 600,
            color: "#fff",
            border: "none",
            cursor: nodes.length === 0 ? "not-allowed" : "pointer",
            background: isRunning
              ? "rgba(239,68,68,0.18)"
              : "var(--app-accent)",
            opacity: nodes.length === 0 ? 0.4 : 1,
            transition: "opacity 0.15s, background 0.2s",
          }}
        >
          {isRunning ? (
            <>
              <Loader2
                size={15}
                style={{ animation: "spin 1s linear infinite" }}
              />
              Stop
            </>
          ) : (
            <>
              <Zap size={15} />
              Deploy
            </>
          )}
        </button>
        <button
          onClick={() => setChatOpen(true)}
          style={{
            width: 50,
            height: 50,
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--app-surface)",
            border: "1px solid var(--app-border)",
            cursor: "pointer",
            color: "var(--app-text-dim)",
            flexShrink: 0,
          }}
        >
          <MessageSquare size={18} />
        </button>
      </div>

      {/* Chat bottom sheet */}
      <ChatPanelSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        nodes={nodes}
        edges={edges}
        workflowId={projectId === "new" ? undefined : projectId}
        workflowName={workflow.name}
        isDeploying={isRunning}
        onDeploy={() => setShowPreDeploy(true)}
      />

      {showPreDeploy && (
        <PreDeployModal
          nodes={nodes}
          edges={edges}
          onConfirm={() => {
            setShowPreDeploy(false);
            handleDeployToggle();
          }}
          onClose={() => setShowPreDeploy(false)}
        />
      )}

      {/* Suppress unused var warning */}
      {isTerminalOpen && null}
    </div>
  );
}
