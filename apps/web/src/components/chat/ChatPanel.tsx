import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, RotateCcw, Download, Search, X } from "lucide-react";
import { useAuth } from "../../context/auth";
import {
  sendCanvasAgent,
  getMyAiUsage,
  type ChatMessage,
  type CanvasUpdatePayload,
  type AIUsageInfo,
} from "../../lib/api";
import { saveChatHistory, loadChatHistory } from "../../lib/workflows";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageList } from "./ChatMessageList";
import { buildCanvasContext } from "./buildCanvasContext";
import type { ChatPanelProps, ParsedMessage } from "./chatTypes";

/** The services `/add` knows by name. Module scope, not component scope: it is
 *  data, and rebuilding it on every keystroke was pure waste. */
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

  // The surface below is classes, not an inline style. --app-nav-bg and
  // --app-border-dim are aliases of --background and --border, so it always
  // painted the right colour — but eslint's palette guard reads className
  // literals and an inline style is invisible to it, which is how three
  // separate literal colours survived a conversion meant to remove them.
  return (
    <div
      data-tour="chat"
      className={`${className ?? "w-[300px] shrink-0"} z-20 flex h-full flex-col border-l border-border bg-background`}
    >
      {/* Copilot header */}
      <div className="flex-shrink-0 border-b border-border-soft">
        {/* via-border, not via-primary/25: --app-accent is var(--primary), so
            the mechanical translation would be a 25%-white line — three times
            brighter than every other divider on this surface. The console's
            divider vocabulary is border / border-soft. */}
        <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative w-7 h-7 rounded-lg bg-primary/[0.12] border border-primary/20 flex items-center justify-center">
                <Sparkles size={13} className="text-primary" />
                <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-ok border-[1.5px] border-background" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground tracking-tight leading-none">
                  AI Copilot
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Describe it, I&apos;ll build it
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {/* A counter against an unbounded limit tells the user nothing —
                  the self-host build simply has no quota badge. */}
              {aiUsage && !aiUsage.unlimited && (
                <span
                  className={`text-[10.5px] font-mono px-1.5 py-0.5 rounded border ${
                    aiUsage.remaining === 0
                      ? "text-warn bg-warn/10 border-warn/20"
                      : aiUsage.remaining <= 5
                        ? "text-warn bg-warn/[0.06] border-warn/15"
                        : "text-muted-foreground bg-secondary border-border-soft"
                  }`}
                >
                  {aiUsage.messages}/{aiUsage.limit}
                </span>
              )}
              {messages.length > 0 && (
                <>
                  <button
                    onClick={() => setSearchOpen((v) => !v)}
                    className={`rounded-lg p-1 transition-colors ${searchOpen ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                    title="Search"
                  >
                    <Search size={11} />
                  </button>
                  <button
                    onClick={handleExport}
                    className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    title="Export"
                  >
                    <Download size={11} />
                  </button>
                  <button
                    onClick={handleClear}
                    className="rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
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
              <Search size={10} className="text-dim flex-shrink-0" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search messages…"
                className="flex-1 bg-transparent text-[12.5px] text-foreground placeholder:text-dim outline-none"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <ChatMessageList
        messages={messages}
        searchQuery={searchQuery}
        loading={loading}
        canApply={!!onAddNodes}
        appliedUpdates={appliedUpdates}
        confirmedUpdates={confirmedUpdates}
        cancelledUpdates={cancelledUpdates}
        onApply={handleApply}
        onConfirm={(idx, update) => {
          if (onAddNodes) onAddNodes(update);
          setConfirmedUpdates((prev) => new Set(prev).add(idx));
        }}
        onCancel={(idx) =>
          setCancelledUpdates((prev) => new Set(prev).add(idx))
        }
        bottomRef={bottomRef}
      />

      <ChatComposer
        input={input}
        setInput={setInput}
        onSend={send}
        onKeyDown={onKey}
        onResize={autoResize}
        textareaRef={textareaRef}
        loading={loading}
        quotaBlocked={quotaBlocked}
        showOpeners={messages.length === 0}
      />
    </div>
  );
}
