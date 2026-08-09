import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Sparkles,
  Send,
  RotateCcw,
  Plus,
  GitBranch,
  Zap,
  Download,
  Search,
  X,
} from "lucide-react";
import { useAuth } from "../../context/auth";
import {
  sendCanvasAgent,
  getMyAiUsage,
  type ChatMessage,
  type CanvasUpdatePayload,
  type AIUsageInfo,
} from "../../lib/api";
import { saveChatHistory, loadChatHistory } from "../../lib/workflows";
import { parseInline, MarkdownContent } from "./MarkdownContent";

interface SimpleNode {
  id: string;
  type: string;
  data?: {
    label?: string;
    provider?: string;
    status?: string;
    provisionedUrl?: string;
    existing_repo?: string;
    [key: string]: unknown;
  };
}

interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  data?: { envVars?: string[]; synced?: boolean };
}

interface ParsedMessage {
  role: "user" | "assistant";
  content: string;
  canvasUpdate?: CanvasUpdatePayload;
  autoApplied?: boolean;
  pendingUpdate?: CanvasUpdatePayload;
}

interface LogEntry {
  time: string;
  source: string;
  msg: string;
  type: "info" | "success" | "error" | "warning";
}

interface ChatPanelProps {
  nodes?: SimpleNode[];
  edges?: SimpleEdge[];
  onAddNodes?: (update: CanvasUpdatePayload) => void;
  workflowId?: string;
  workflowName?: string;
  initialMessages?: Array<{ role: "user" | "assistant"; content: string }>;
  onDeploy?: () => void;
  onApplyTemplate?: (templateName: string) => void;
  isDeploying?: boolean;
  deployLogs?: LogEntry[];
  className?: string;
  currentEnvName?: string;
  currentEnvIsDefault?: boolean;
  environments?: Array<{ name: string; slug: string; is_default: boolean }>;
}

const NODE_TYPE_COLORS: Record<string, string> = {
  trigger: "text-green-400  bg-green-400/10  border-green-400/20",
  agent: "text-blue-400   bg-blue-400/10   border-blue-400/20",
  action: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  logic: "text-amber-400  bg-amber-400/10  border-amber-400/20",
  approval: "text-orange-400 bg-orange-400/10 border-orange-400/20",
};

function CanvasUpdateCard({
  update,
  onApply,
  applied,
}: {
  update: CanvasUpdatePayload;
  onApply: () => void;
  applied: boolean;
}) {
  return (
    <div className="mt-1.5 rounded-xl border border-border/70 bg-secondary/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        <GitBranch size={11} className="text-primary/60 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">
          {update.description ??
            `${update.nodes.length} node${update.nodes.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Nodes preview */}
      <div className="px-3 py-2 flex flex-col gap-1">
        {update.nodes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border ${NODE_TYPE_COLORS[n.type] ?? "text-muted-foreground bg-secondary/40 border-border"}`}
            >
              {n.type}
            </span>
            <span className="text-[13px] text-foreground/65 truncate">
              {String(n.data?.label ?? n.type)}
            </span>
          </div>
        ))}
        {update.edges.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5 pt-1.5 border-t border-border/40">
            <Zap size={9} className="text-muted-foreground/60 flex-shrink-0" />
            <span className="text-[11px] text-muted-foreground/70 font-mono">
              {update.edges.length} connection
              {update.edges.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Apply button */}
      <div className="px-3 pb-3">
        <button
          onClick={onApply}
          disabled={applied}
          className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all ${
            applied
              ? "bg-green-500/10 border border-green-500/20 text-green-400/60 cursor-default"
              : "bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 hover:border-primary/40 active:scale-[0.98]"
          }`}
        >
          {applied ? (
            <>
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
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Added to canvas
            </>
          ) : (
            <>
              <Plus size={11} />
              Add to canvas
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function ConfirmCard({
  update,
  onApply,
  onCancel,
  applied,
  cancelled,
}: {
  update: CanvasUpdatePayload;
  onApply: () => void;
  onCancel: () => void;
  applied: boolean;
  cancelled: boolean;
}) {
  const isDone = applied || cancelled;
  if (isDone) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-secondary/30 border border-border/50">
        <span
          className={`text-[12px] font-semibold ${applied ? "text-amber-400/60" : "text-muted-foreground/70"}`}
        >
          {applied ? "✓ Applied" : "✕ Cancelled"}
        </span>
        {update.description && (
          <span className="text-[12px] text-muted-foreground/60 truncate">
            — {update.description}
          </span>
        )}
      </div>
    );
  }

  const removeCount = update.remove?.length ?? 0;
  const disconnCount = update.disconnect?.length ?? 0;

  return (
    <div className="mt-1.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/10">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 2L14.928 14H1.072L8 2Z"
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 6V9"
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.5" r="0.75" fill="#f59e0b" />
        </svg>
        <span className="text-[12px] font-semibold text-amber-400/80 uppercase tracking-wider">
          Confirmation required
        </span>
      </div>
      <div className="px-3 py-2 flex flex-col gap-0.5">
        {update.description && (
          <p className="text-[13px] text-foreground/60 mb-1">
            {update.description}
          </p>
        )}
        {removeCount > 0 && (
          <p className="text-[12px] text-muted-foreground font-mono">
            Remove {removeCount} node{removeCount !== 1 ? "s" : ""} from canvas
          </p>
        )}
        {disconnCount > 0 && (
          <p className="text-[12px] text-muted-foreground font-mono">
            Disconnect {disconnCount} edge{disconnCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button
          onClick={onApply}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-400 hover:bg-amber-500/25 hover:border-amber-500/50 active:scale-[0.98] transition-all"
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold border border-border/70 text-muted-foreground/80 hover:text-foreground/50 hover:bg-secondary/40 active:scale-[0.98] transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

const SERVICE_NODE_TYPES = new Set(["service", "trigger"]);

function buildCanvasContext(
  nodes: SimpleNode[],
  edges: SimpleEdge[] = [],
  opts?: {
    isDeploying?: boolean;
    deployLogs?: LogEntry[];
    workflowName?: string;
    currentEnvName?: string;
    currentEnvIsDefault?: boolean;
    environments?: Array<{ name: string; slug: string; is_default: boolean }>;
  },
): string {
  const serviceNodes = nodes.filter((n) => SERVICE_NODE_TYPES.has(n.type));

  if (serviceNodes.length === 0)
    return "Canvas is empty — no service nodes yet.";

  // Only count service↔service edges so (no connections) is accurate
  const serviceIds = new Set(serviceNodes.map((n) => n.id));
  const serviceEdges = edges.filter(
    (e) => serviceIds.has(e.source) && serviceIds.has(e.target),
  );
  const connectedIds = new Set(
    serviceEdges.flatMap((e) => [e.source, e.target]),
  );

  const nodeLines = serviceNodes
    .map((n) => {
      const d = n.data ?? {};
      const parts: string[] = [`id:${n.id}`, `label:${d.label ?? n.type}`];
      if (d.provider) parts.push(`provider:${String(d.provider)}`);
      const status = d.status as string | undefined;
      if (status && status !== "draft") parts.push(`status:${status}`);
      if (d.errorMsg) parts.push(`errorMsg:${String(d.errorMsg)}`);
      if (d.provisionedUrl) parts.push(`url:${String(d.provisionedUrl)}`);
      if (d.existing_repo) parts.push(`repo:${String(d.existing_repo)}`);
      if (d.projectName) parts.push(`projectName:${String(d.projectName)}`);
      if (d.region) parts.push(`region:${String(d.region)}`);
      if (d.fromEmail) parts.push(`fromEmail:${String(d.fromEmail)}`);
      if (d.senderName) parts.push(`senderName:${String(d.senderName)}`);
      if (!connectedIds.has(n.id)) parts.push("(no connections — isolated)");
      return parts.join(" | ");
    })
    .join("\n");

  let envLine = "";
  if (opts?.currentEnvName) {
    const tag = opts.currentEnvIsDefault ? " (default/production)" : "";
    envLine = `Environment: ${opts.currentEnvName}${tag}`;
    if (opts.environments && opts.environments.length > 1) {
      const others = opts.environments
        .filter((e) => e.name !== opts.currentEnvName)
        .map((e) => e.name)
        .join(", ");
      envLine += ` | Other environments: ${others}`;
    }
    envLine += "\n";
  }

  let ctx = opts?.workflowName
    ? `Workflow: ${opts.workflowName}\n${envLine}Canvas nodes:\n${nodeLines}`
    : `${envLine}Canvas nodes:\n${nodeLines}`;

  if (serviceEdges.length > 0) {
    const edgeLines = serviceEdges
      .map((e) => {
        const srcLabel =
          serviceNodes.find((n) => n.id === e.source)?.data?.label ?? e.source;
        const tgtLabel =
          serviceNodes.find((n) => n.id === e.target)?.data?.label ?? e.target;
        const parts: string[] = [
          `${srcLabel}(${e.source}) → ${tgtLabel}(${e.target})`,
        ];
        if (e.data?.envVars?.length) {
          parts.push(`envVars:${e.data.envVars.join(",")}`);
          parts.push(
            e.data.synced ? "[synced]" : "[NOT synced — deploy needed]",
          );
        } else {
          parts.push("[config edge — no env vars]");
        }
        return parts.join(" | ");
      })
      .join("\n");
    ctx += `\n\nCanvas edges:\n${edgeLines}`;
  } else {
    ctx += "\n\nCanvas edges: none";
  }

  if (opts?.isDeploying !== undefined) {
    ctx += `\n\n[provision status] deploying:${opts.isDeploying}`;
  }

  if (opts?.deployLogs?.length) {
    const recent = opts.deployLogs.slice(-10);
    const logLines = recent
      .map((l) => `[${l.type}] ${l.source}: ${l.msg}`)
      .join("\n");
    ctx += `\n\n[deploy logs]\n${logLines}`;
  }

  return ctx;
}

export function ChatPanel({
  nodes = [],
  edges = [],
  onAddNodes,
  workflowId,
  workflowName,
  initialMessages,
  onDeploy,
  onApplyTemplate,
  isDeploying,
  deployLogs,
  className,
  currentEnvName,
  currentEnvIsDefault,
  environments,
}: ChatPanelProps) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [appliedUpdates, setAppliedUpdates] = useState<Set<number>>(new Set());
  const [confirmedUpdates, setConfirmedUpdates] = useState<Set<number>>(
    new Set(),
  );
  const [cancelledUpdates, setCancelledUpdates] = useState<Set<number>>(
    new Set(),
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [aiUsage, setAiUsage] = useState<AIUsageInfo | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const workflowIdRef = useRef(workflowId);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load chat history from DB on mount when workflowId is real
  useEffect(() => {
    if (!workflowId || workflowId === "new") return;
    loadChatHistory(workflowId)
      .then((stored) => {
        if (stored.length > 0)
          setMessages(
            stored.map((m) => ({
              role: m.role,
              content: m.content,
              canvasUpdate: m.canvasUpdate as CanvasUpdatePayload | undefined,
              pendingUpdate: m.pendingUpdate as CanvasUpdatePayload | undefined,
              autoApplied: m.autoApplied,
            })),
          );
      })
      .catch(() => {
        /* non-fatal */
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed messages from initialMessages when they arrive (e.g. /new → workspace handoff)
  useEffect(() => {
    if (initialMessages?.length && messages.length === 0) {
      setMessages(
        initialMessages.map((m) => ({ role: m.role, content: m.content })),
      );
    }
  }, [initialMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced save to DB on every message change
  useEffect(() => {
    const id = workflowIdRef.current;
    if (!id || id === "new") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveChatHistory(
        id,
        messages.map((m) => ({
          role: m.role,
          content: m.content,
          canvasUpdate: m.canvasUpdate,
          pendingUpdate: m.pendingUpdate,
          autoApplied: m.autoApplied,
        })),
      ).catch(() => {});
    }, 1500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages]);

  // When workflowId changes from 'new' to real ID, save current messages immediately
  useEffect(() => {
    if (
      workflowId &&
      workflowId !== "new" &&
      workflowIdRef.current !== workflowId
    ) {
      workflowIdRef.current = workflowId;
      if (messages.length > 0) {
        saveChatHistory(
          workflowId,
          messages.map((m) => ({
            role: m.role,
            content: m.content,
            canvasUpdate: m.canvasUpdate,
            pendingUpdate: m.pendingUpdate,
            autoApplied: m.autoApplied,
          })),
        ).catch(() => {});
      }
    }
  }, [workflowId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 30);
    else setSearchQuery("");
  }, [searchOpen]);

  // Pre-fill from canvas empty-state suggestion chips
  useEffect(() => {
    const handler = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (!text) return;
      setInput(text);
      setTimeout(() => textareaRef.current?.focus(), 50);
    };
    window.addEventListener("leenar:chat-prefill", handler);
    return () => window.removeEventListener("leenar:chat-prefill", handler);
  }, []);

  const SLASH_SERVICE_MAP: Record<
    string,
    { label: string; iconName: string; provider: string; description: string }
  > = {
    vercel: {
      label: "Vercel",
      iconName: "Triangle",
      provider: "vercel",
      description: "Frontend cloud platform",
    },
    supabase: {
      label: "Supabase",
      iconName: "Database",
      provider: "supabase",
      description: "Database & Auth",
    },
    github: {
      label: "GitHub",
      iconName: "Github",
      provider: "github",
      description: "Source code & version control",
    },
    resend: {
      label: "Resend",
      iconName: "Send",
      provider: "resend",
      description: "Transactional email",
    },
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !session) return;

    // Slash command interceptor
    if (text.startsWith("/")) {
      const parts = text.trim().split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const arg = parts[1]?.toLowerCase() ?? "";
      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "1px";

      if (cmd === "/help") {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          {
            role: "assistant",
            content:
              "Available commands:\n" +
              "/add [service] — Add a node (vercel, supabase, github, resend)\n" +
              "/deploy — Start provisioning\n" +
              "/clear — Clear chat history\n" +
              "/help — Show this list",
          },
        ]);
        return;
      }

      if (cmd === "/clear") {
        handleClear();
        return;
      }

      if (cmd === "/deploy") {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          {
            role: "assistant",
            content: onDeploy
              ? "Triggering deployment…"
              : "No deploy action available from chat.",
          },
        ]);
        if (onDeploy) onDeploy();
        return;
      }

      if (cmd === "/add") {
        const svcData = SLASH_SERVICE_MAP[arg];
        if (svcData && onAddNodes) {
          onAddNodes({
            nodes: [{ type: "service", data: svcData }],
            edges: [],
          });
          setMessages((prev) => [
            ...prev,
            { role: "user", content: text },
            {
              role: "assistant",
              content: `Added **${svcData.label}** to the canvas.`,
            },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "user", content: text },
            {
              role: "assistant",
              content: arg
                ? `Unknown service "${arg}". Try: /add vercel, /add supabase, /add github, /add resend`
                : "Usage: /add [service] — e.g. /add vercel",
            },
          ]);
        }
        return;
      }

      // Unknown slash command — fall through to AI (strip the "/" prefix)
    }

    const next: ParsedMessage[] = [
      ...messages,
      { role: "user", content: text },
    ];
    setMessages(next);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "1px";
    setLoading(true);

    try {
      // Build canvas-aware messages for the API
      const canvasCtx: ChatMessage = {
        role: "user",
        content: `[canvas state] ${buildCanvasContext(nodes, edges, { isDeploying, deployLogs, workflowName, currentEnvName, currentEnvIsDefault, environments })}`,
      };
      const ctxAck: ChatMessage = { role: "assistant", content: "Got it." };
      // Strip CANVAS_UPDATE / PENDING blocks from history — AI only needs the reply text,
      // not the raw JSON which can confuse it when re-read as context
      const historyMessages: ChatMessage[] = messages
        .map((m) => ({
          role: m.role,
          content: m.content
            .replace(/<CANVAS_UPDATE>[\s\S]*?<\/CANVAS_UPDATE>/g, "")
            .replace(/<PENDING>[\s\S]*?<\/PENDING>/g, "")
            .trim(),
        }))
        .filter((m) => m.content.length > 0);

      const apiMessages: ChatMessage[] = [
        canvasCtx,
        ctxAck,
        ...historyMessages,
        { role: "user", content: text },
      ];

      const snapshot = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type,
          data: n.data,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
        })),
      };

      const res = await sendCanvasAgent(apiMessages, session, {
        projectId: workflowIdRef.current ?? undefined,
        canvas: snapshot,
      });

      // Quota exceeded — show error message, block further sends
      if (res.quotaExceeded) {
        setQuotaBlocked(true);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              res.error ?? "Daily AI limit reached. Resets at midnight UTC.",
          },
        ]);
        return;
      }

      const canvasUpdate = res.canvasUpdate;
      const autoApplied = !!(canvasUpdate && onAddNodes);
      if (autoApplied) onAddNodes!(canvasUpdate!);

      const parsed: ParsedMessage = {
        role: "assistant",
        content: res.reply || "",
        canvasUpdate,
        autoApplied,
        pendingUpdate: res.canvasPending,
      };
      setMessages((prev) => [...prev, parsed]);
      refreshUsage();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, session, nodes, edges]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "1px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const handleApply = useCallback(
    (msgIdx: number, update: CanvasUpdatePayload) => {
      if (!onAddNodes) return;
      onAddNodes(update);
      setAppliedUpdates((prev) => new Set(prev).add(msgIdx));
    },
    [onAddNodes],
  );

  const refreshUsage = useCallback(() => {
    if (!session) return;
    getMyAiUsage(session)
      .then(setAiUsage)
      .catch(() => {
        console.warn("[ChatPanel] Failed to refresh AI usage quota");
      });
  }, [session]);

  useEffect(() => {
    refreshUsage();
  }, [refreshUsage]);

  const handleClear = () => {
    setMessages([]);
    setAppliedUpdates(new Set());
    const id = workflowIdRef.current;
    if (id && id !== "new") saveChatHistory(id, []).catch(() => {});
  };

  const handleExport = () => {
    const lines = [`# Leenar Chat\n*${new Date().toLocaleString()}*\n`];
    for (const m of messages) {
      lines.push(`**${m.role === "user" ? "You" : "Leenar"}:** ${m.content}`);
    }
    const blob = new Blob([lines.join("\n\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leenar-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-tour="chat"
      className={`${className ?? "w-[300px] shrink-0"} h-full flex flex-col z-20`}
      style={{
        background: "var(--app-nav-bg)",
        borderLeft: "1px solid var(--app-border-dim)",
      }}
    >
      {/* Copilot header */}
      <div className="flex-shrink-0 border-b border-border/50">
        <div className="h-px bg-gradient-to-r from-transparent via-[var(--app-accent)]/25 to-transparent" />
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative w-7 h-7 rounded-lg bg-[var(--app-accent)]/[0.12] border border-[var(--app-accent)]/20 flex items-center justify-center">
                <Sparkles size={13} className="text-[var(--app-accent)]/80" />
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400/80 border-[1.5px] border-black/30" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground/85 tracking-tight leading-none">
                  AI Copilot
                </p>
                <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                  Describe it, I&apos;ll build it
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {aiUsage && (
                <span
                  className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded border ${
                    aiUsage.remaining === 0
                      ? "text-amber-400/70 bg-amber-400/10 border-amber-400/20"
                      : aiUsage.remaining <= 5
                        ? "text-amber-400/50 bg-amber-400/[0.06] border-amber-400/15"
                        : "text-muted-foreground/60 bg-secondary/40 border-border/50"
                  }`}
                >
                  {aiUsage.messages}/{aiUsage.limit}
                </span>
              )}
              {messages.length > 0 && (
                <>
                  <button
                    onClick={() => setSearchOpen((v) => !v)}
                    className={`p-1 rounded-md transition-colors ${searchOpen ? "bg-white/10 text-foreground/55" : "text-muted-foreground/60 hover:text-white/45 hover:bg-secondary/40"}`}
                    title="Search"
                  >
                    <Search size={11} />
                  </button>
                  <button
                    onClick={handleExport}
                    className="p-1 rounded-md text-muted-foreground/60 hover:text-white/45 hover:bg-secondary/40 transition-colors"
                    title="Export"
                  >
                    <Download size={11} />
                  </button>
                  <button
                    onClick={handleClear}
                    className="p-1 rounded-md text-muted-foreground/60 hover:text-white/45 hover:bg-secondary/40 transition-colors"
                    title="Clear"
                  >
                    <RotateCcw size={11} />
                  </button>
                </>
              )}
            </div>
          </div>
          {searchOpen && (
            <div className="flex items-center gap-1.5 mt-2 px-0">
              <Search size={10} className="text-white/28 flex-shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages…"
                className="flex-1 bg-transparent text-[12.5px] text-foreground/65 placeholder-white/22 outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-0.5 text-muted-foreground/60 hover:text-white/45"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--app-accent)]/[0.07] border border-[var(--app-accent)]/[0.12] flex items-center justify-center">
              <Sparkles size={16} className="text-[var(--app-accent)]/40" />
            </div>
            <p className="text-[12px] text-white/28 text-center leading-relaxed px-4">
              Describe what you want to build.
            </p>
          </div>
        ) : (
          <>
            {messages
              .map((msg, originalIdx) => ({ msg, originalIdx }))
              .filter(
                ({ msg }) =>
                  !searchQuery ||
                  msg.content.toLowerCase().includes(searchQuery.toLowerCase()),
              )
              .map(({ msg, originalIdx }) => (
                <div
                  key={originalIdx}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  {msg.content &&
                    (msg.role === "user" ? (
                      <div className="max-w-[88%] bg-[var(--app-accent)]/[0.14] text-white/82 rounded-2xl rounded-br-md px-3 py-2.5 text-[13px] leading-relaxed border border-[var(--app-accent)]/[0.18] shadow-sm">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="max-w-[97%] w-full">
                        <div className="flex items-start gap-2">
                          <div className="w-5 h-5 rounded-md bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Sparkles
                              size={9}
                              className="text-[var(--app-accent)]/75"
                            />
                          </div>
                          <div className="text-[13px] leading-relaxed text-white/72 flex-1 min-w-0">
                            <MarkdownContent text={msg.content} />
                          </div>
                        </div>
                      </div>
                    ))}
                  {msg.role === "assistant" && msg.canvasUpdate && (
                    <div className="w-full max-w-[92%]">
                      <CanvasUpdateCard
                        update={msg.canvasUpdate}
                        onApply={() =>
                          handleApply(originalIdx, msg.canvasUpdate!)
                        }
                        applied={
                          msg.autoApplied || appliedUpdates.has(originalIdx)
                        }
                      />
                    </div>
                  )}
                  {msg.role === "assistant" && msg.pendingUpdate && (
                    <div className="w-full max-w-[92%]">
                      <ConfirmCard
                        update={msg.pendingUpdate}
                        onApply={() => {
                          if (onAddNodes) onAddNodes(msg.pendingUpdate!);
                          setConfirmedUpdates((prev) =>
                            new Set(prev).add(originalIdx),
                          );
                        }}
                        onCancel={() =>
                          setCancelledUpdates((prev) =>
                            new Set(prev).add(originalIdx),
                          )
                        }
                        applied={confirmedUpdates.has(originalIdx)}
                        cancelled={cancelledUpdates.has(originalIdx)}
                      />
                    </div>
                  )}
                </div>
              ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2.5 py-2 px-3 rounded-2xl bg-secondary/30 border border-border/50">
                  <div className="w-5 h-5 rounded-md bg-[var(--app-accent)]/15 border border-[var(--app-accent)]/20 flex items-center justify-center flex-shrink-0">
                    <Sparkles
                      size={9}
                      className="text-[var(--app-accent)]/70"
                    />
                  </div>
                  <div className="flex gap-1 items-center">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-1 h-1 rounded-full bg-white/30"
                        style={{
                          animation: `bounce 1.2s ${i * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="flex-shrink-0 px-3 pt-2 pb-3 border-t border-border/50">
        {/* Suggestion chips */}
        {messages.length === 0 && !quotaBlocked && (
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {[
              "GitHub + Vercel + Supabase",
              "Add email with Resend",
              "Connect my existing repo",
            ].map((hint, i) => (
              <button
                key={i}
                onClick={() => {
                  setInput(hint);
                  textareaRef.current?.focus();
                }}
                className="text-[11.5px] text-muted-foreground hover:text-foreground/60 bg-secondary/30 hover:bg-secondary/50 border border-border/60 hover:border-border rounded-full px-2.5 py-1 transition-colors"
              >
                {hint}
              </button>
            ))}
          </div>
        )}
        {quotaBlocked && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-400/75 text-center">
            Daily limit reached — resets at midnight UTC
          </div>
        )}
        <div className="flex gap-2 items-end bg-secondary/30 border border-border/70 rounded-xl p-1.5 focus-within:border-white/[0.13] focus-within:bg-secondary/40 transition-all">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={onKey}
            placeholder={
              quotaBlocked
                ? "Daily limit reached…"
                : "Ask anything, or / for commands…"
            }
            rows={1}
            disabled={loading || quotaBlocked}
            className="flex-1 bg-transparent py-1.5 px-2 text-[13px] text-foreground/85 focus:outline-none resize-none leading-relaxed placeholder:text-muted-foreground/70 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading || quotaBlocked}
            className="flex-shrink-0 p-2 bg-[var(--app-accent)] hover:opacity-90 rounded-lg text-[var(--app-text-white)] transition-all shadow-md shadow-[var(--app-accent)]/20 disabled:opacity-25 disabled:shadow-none active:scale-95"
          >
            <Send size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
