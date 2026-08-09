import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Session } from "@supabase/supabase-js";
import {
  sendDashboardAgent,
  confirmAgentAction,
  listDashboardChats,
  getDashboardChat,
  createDashboardChat,
  updateDashboardChat,
  deleteDashboardChat,
  type ChatMessage,
  type ConversationMeta,
} from "../../lib/api";
import { buildDashboardContext } from "../../lib/dashboardContext";
import type { DashboardData } from "../../hooks/useProjectDashboard";
import { MarkdownContent } from "../chat/MarkdownContent";
import { cn } from "../../lib/utils";

interface PendingAction {
  id: string;
  summary: string;
}

interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  pending?: PendingAction;
  hidden?: boolean;
}

interface Props {
  data: DashboardData;
  session: Session;
  onActionDone: () => void;
}

function ActionConfirmCard({
  pending,
  session,
  onDone,
  onDismiss,
}: {
  pending: PendingAction;
  session: Session;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleConfirm() {
    setState("loading");
    try {
      const res = await confirmAgentAction(pending.id, session);
      if (!res.ok) {
        setErrorMsg(res.message);
        setState("error");
        return;
      }
      setState("done");
      onDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Action failed");
      setState("error");
    }
  }

  if (state === "done") {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold text-emerald-400">
          ✓ Done
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-[400px] overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-[7px] text-[11px] font-bold uppercase tracking-[0.07em] text-yellow-500">
          ⚡ Confirm: {pending.summary}
        </div>
        {errorMsg && (
          <div className="px-3 py-1.5 text-xs text-destructive">{errorMsg}</div>
        )}
        <div className="flex gap-2 px-3 py-2">
          <button
            onClick={handleConfirm}
            disabled={state === "loading"}
            className="flex-1 cursor-pointer rounded border border-border bg-secondary px-3 py-1.5 text-[13px] font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60 hover:bg-secondary/80"
          >
            {state === "loading" ? "Applying…" : "Approve"}
          </button>
          <button
            onClick={onDismiss}
            disabled={state === "loading"}
            className="flex-1 cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 text-[13px] font-medium text-muted-foreground disabled:cursor-not-allowed hover:bg-secondary hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function generateTitle(firstUserText: string, briefReply?: string): string {
  if (briefReply) {
    const match = briefReply.match(/\*\*Status:\s*(OK|DEGRADED|CRITICAL)\*\*/);
    if (match) {
      const d = new Date();
      const dd = String(d.getDate()).padStart(2, "0");
      const mon = d.toLocaleString("en-US", { month: "short" });
      return `${dd} ${mon} · Status: ${match[1]}`;
    }
  }
  return firstUserText.trim().slice(0, 40) || "New conversation";
}

function ConversationItem({
  conv,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  conv: ConversationMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conv.title);

  function submitRename() {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conv.title) onRename(trimmed);
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 border-l-2 py-[7px] pl-3 pr-3",
        isActive
          ? "border-foreground/40 bg-secondary"
          : "border-transparent bg-transparent",
      )}
    >
      {editing ? (
        <input
          autoFocus
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          onBlur={submitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitRename();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-[inherit] text-xs text-foreground outline-none"
        />
      ) : (
        <div
          onClick={onSelect}
          className={`min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-xs ${isActive ? "text-foreground" : "text-muted-foreground"}`}
        >
          {conv.title || "Untitled"}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
          setEditTitle(conv.title);
        }}
        title="Rename"
        className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[11px] text-muted-foreground opacity-60 hover:opacity-100"
      >
        ✏
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        className="shrink-0 cursor-pointer rounded border-none bg-transparent px-1 py-0.5 text-[11px] text-muted-foreground opacity-60 hover:opacity-100"
      >
        🗑
      </button>
    </div>
  );
}

export function DashboardAgent({ data, session, onActionDone }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [activeCard, setActiveCard] = useState<{
    pending: PendingAction;
    msgIdx: number;
  } | null>(null);
  const [dismissedActions, setDismissedActions] = useState<Set<number>>(
    new Set(),
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const contextInjectedRef = useRef(false);

  useEffect(() => {
    if (open && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    contextInjectedRef.current = false;
    setTimeout(() => inputRef.current?.focus(), 50);

    const projectId = data.summary?.id;
    if (!projectId) {
      triggerAutoBrief();
      return;
    }

    let cancelled = false;
    async function loadOnOpen() {
      try {
        const list = await listDashboardChats(projectId!, session);
        if (cancelled) return;
        setConversations(list);
        if (list.length > 0) {
          const full = await getDashboardChat(list[0].id, session);
          if (cancelled) return;
          const msgs = full.messages as AgentMessage[];
          setMessages(msgs);
          setConversationId(list[0].id);
          contextInjectedRef.current = msgs.some((m) => m.hidden);
        } else {
          triggerAutoBrief();
        }
      } catch {
        triggerAutoBrief();
      }
    }
    loadOnOpen();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    contextInjectedRef.current = false;
  }, [data.summary?.id]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (activeCard) {
          setActiveCard(null);
        } else if (historyOpen) {
          setHistoryOpen(false);
        } else {
          setOpen(false);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, historyOpen, activeCard]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading || quotaExceeded) return;

    const nextMessages: AgentMessage[] = [
      ...messages,
      { role: "user" as const, content: text },
    ];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const historyForApi: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let apiMessages: ChatMessage[];
      if (!contextInjectedRef.current) {
        const ctxMsg: ChatMessage = {
          role: "user",
          content: `[dashboard state] ${buildDashboardContext(data)}`,
        };
        const ackMsg: ChatMessage = {
          role: "assistant",
          content: "Got it. How can I help with your infrastructure?",
        };
        apiMessages = [
          ctxMsg,
          ackMsg,
          ...historyForApi,
          { role: "user", content: text },
        ];
        contextInjectedRef.current = true;
      } else {
        apiMessages = [...historyForApi, { role: "user", content: text }];
      }

      const res = await sendDashboardAgent(
        apiMessages,
        session,
        data.summary?.id ?? undefined,
      );

      if (res.quotaExceeded) {
        setQuotaExceeded(true);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.error ?? "Daily AI limit reached. Try again tomorrow.",
          },
        ]);
        return;
      }

      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: res.reply || "",
        pending: res.pending ?? undefined,
      };
      const messagesToSave = [...nextMessages, assistantMsg];
      setMessages((prev) => [...prev, assistantMsg]);

      const projectId = data.summary?.id;
      if (projectId) {
        try {
          if (conversationId) {
            await updateDashboardChat(
              conversationId,
              { messages: messagesToSave as object[] },
              session,
            );
          } else {
            const title = generateTitle(text);
            const created = await createDashboardChat(
              projectId,
              title,
              messagesToSave as object[],
              session,
            );
            setConversationId(created.id);
            setConversations((prev) => [
              {
                id: created.id,
                title: created.title,
                created_at: created.created_at,
                updated_at: created.updated_at,
              },
              ...prev,
            ]);
          }
        } catch {
          // save failed silently
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            err instanceof Error
              ? err.message
              : "Something went wrong. Try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleNewConversation() {
    setMessages([]);
    setConversationId(null);
    setHistoryOpen(false);
    contextInjectedRef.current = false;
    triggerAutoBrief(true);
  }

  async function handleSelectConversation(id: string) {
    if (id === conversationId) {
      setHistoryOpen(false);
      return;
    }
    try {
      const full = await getDashboardChat(id, session);
      const msgs = full.messages as AgentMessage[];
      setMessages(msgs);
      setConversationId(id);
      contextInjectedRef.current = msgs.some((m) => m.hidden);
      setHistoryOpen(false);
    } catch {
      // silent fail
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await deleteDashboardChat(id, session);
      const updated = conversations.filter((c) => c.id !== id);
      setConversations(updated);
      if (id === conversationId) {
        if (updated.length > 0) {
          await handleSelectConversation(updated[0].id);
        } else {
          setMessages([]);
          setConversationId(null);
          triggerAutoBrief(true);
        }
      }
    } catch {
      // silent fail
    }
  }

  async function handleRenameConversation(id: string, title: string) {
    try {
      await updateDashboardChat(id, { title }, session);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c)),
      );
    } catch {
      // silent fail
    }
  }

  async function triggerAutoBrief(force = false) {
    if (loading || (!force && messages.length > 0)) return;
    setLoading(true);
    try {
      const ctxMsg: ChatMessage = {
        role: "user",
        content: `[dashboard state] ${buildDashboardContext(data)}`,
      };
      const ackMsg: ChatMessage = {
        role: "assistant",
        content: "Got it. How can I help with your infrastructure?",
      };
      const triggerMsg: ChatMessage = {
        role: "user",
        content:
          "Generate a DevOps status brief for this project based on the dashboard state above.",
      };
      contextInjectedRef.current = true;

      const res = await sendDashboardAgent(
        [ctxMsg, ackMsg, triggerMsg],
        session,
        data.summary?.id ?? undefined,
      );

      if (res.quotaExceeded) {
        setQuotaExceeded(true);
        setMessages([
          {
            role: "assistant",
            content: res.error ?? "Daily AI limit reached. Try again tomorrow.",
          },
        ]);
        return;
      }

      const fullMessages: AgentMessage[] = [
        { role: "user", content: ctxMsg.content, hidden: true },
        { role: "assistant", content: ackMsg.content, hidden: true },
        {
          role: "user",
          content:
            "Generate a DevOps status brief for this project based on the dashboard state above.",
          hidden: true,
        },
        {
          role: "assistant",
          content: res.reply || "",
          pending: res.pending ?? undefined,
        },
      ];
      setMessages(fullMessages);

      const projectId = data.summary?.id;
      if (projectId) {
        try {
          const title = generateTitle("", res.reply || "");
          const created = await createDashboardChat(
            projectId,
            title,
            fullMessages as object[],
            session,
          );
          setConversationId(created.id);
          setConversations((prev) => [
            {
              id: created.id,
              title: created.title,
              created_at: created.created_at,
              updated_at: created.updated_at,
            },
            ...prev,
          ]);
        } catch {
          // save failed silently
        }
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }

  const visibleMessages = messages.filter((m) => !m.hidden);

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Ask your DevOps assistant"
        className="fixed bottom-[88px] right-6 z-[1000] flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-[13px] font-semibold tracking-[0.01em] text-foreground shadow-md transition-colors hover:border-foreground/20 hover:bg-secondary"
      >
        <span className="text-[15px]">✦</span>
        <span>DevOps AI</span>
        {open && <span className="ml-0.5 text-[11px] opacity-50">✕</span>}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1001] bg-black/40 backdrop-blur-[2px]"
        />
      )}

      {/* Drawer */}
      <div
        className="fixed bottom-0 right-0 top-0 z-[1002] flex w-[400px] flex-col border-l border-border bg-background shadow-2xl transition-transform duration-[250ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Drawer header */}
        <div className="relative shrink-0">
          <div
            className={cn(
              "flex items-center justify-between px-4 py-3",
              !historyOpen && "border-b border-border",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[15px] text-muted-foreground">✦</span>
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-[inherit] text-[13px] font-bold uppercase tracking-[0.06em] text-muted-foreground hover:text-foreground"
              >
                DevOps Assistant
                <span className="text-[9px] opacity-60">
                  {historyOpen ? "▲" : "▼"}
                </span>
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded border-none bg-transparent px-1.5 py-0.5 text-[16px] leading-none text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>

          {/* History dropdown */}
          {historyOpen && (
            <div className="max-h-60 overflow-y-auto border-b border-border bg-background">
              <button
                onClick={handleNewConversation}
                className="w-full cursor-pointer border-none border-b border-border bg-transparent px-4 py-2 text-left font-[inherit] text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                + New conversation
              </button>
              {conversations.length === 0 && (
                <div className="px-4 py-[10px] text-xs text-muted-foreground opacity-50">
                  No saved conversations
                </div>
              )}
              {conversations.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  isActive={conv.id === conversationId}
                  onSelect={() => handleSelectConversation(conv.id)}
                  onDelete={() => handleDeleteConversation(conv.id)}
                  onRename={(title) => handleRenameConversation(conv.id, title)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Message list */}
        <div
          ref={scrollContainerRef}
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        >
          {visibleMessages.length === 0 && !loading && (
            <div className="mt-10 text-center text-[13px] leading-relaxed text-muted-foreground">
              <div className="mb-3 text-[28px] opacity-40">✦</div>
              <div className="mb-1.5 font-semibold">
                Ask about your infrastructure
              </div>
              <div className="text-xs opacity-50">
                Open incidents, drifts, recent deploys,
                <br />
                usage — I can help.
              </div>
            </div>
          )}
          {visibleMessages.length === 0 && loading && (
            <div className="mt-10 text-center text-[13px] leading-relaxed text-muted-foreground">
              <div className="mb-3 text-[28px] opacity-30">✦</div>
              <div className="text-xs opacity-50">
                Analyzing your infrastructure…
              </div>
            </div>
          )}

          {visibleMessages.map((msg, idx) => (
            <div key={idx}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[82%] rounded-md border border-border bg-secondary px-3 py-2 text-[13px] leading-[1.5] text-foreground">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="text-[13px] leading-[1.6] text-foreground">
                  <MarkdownContent text={msg.content} />
                  {msg.pending && !dismissedActions.has(idx) && (
                    <button
                      onClick={() =>
                        setActiveCard({ pending: msg.pending!, msgIdx: idx })
                      }
                      className="mt-2 w-full cursor-pointer rounded border border-border bg-secondary px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.07em] text-yellow-500 transition-colors hover:bg-secondary/80"
                    >
                      ⚡ Needs approval: {msg.pending.summary}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="text-xs italic text-muted-foreground opacity-60">
              Thinking…
            </div>
          )}
        </div>

        {/* Quota exceeded */}
        {quotaExceeded && (
          <div className="mx-4 mb-2.5 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Daily AI limit reached. Try again tomorrow.
          </div>
        )}

        {/* Input area */}
        <div className="flex shrink-0 items-end gap-2 border-t border-border px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              quotaExceeded ? "Daily limit reached" : "Ask about your infra…"
            }
            disabled={loading || quotaExceeded}
            rows={1}
            className="flex-1 resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 font-[inherit] text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring disabled:opacity-50"
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || quotaExceeded}
            className="shrink-0 cursor-pointer whitespace-nowrap rounded-md border border-border bg-secondary px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>

      {activeCard && (
        <ActionConfirmCard
          pending={activeCard.pending}
          session={session}
          onDone={() => {
            onActionDone();
            setDismissedActions(
              (prev) => new Set([...prev, activeCard.msgIdx]),
            );
            setActiveCard(null);
          }}
          onDismiss={() => {
            setDismissedActions(
              (prev) => new Set([...prev, activeCard.msgIdx]),
            );
            setActiveCard(null);
          }}
        />
      )}
    </>
  );
}
