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
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
        {/* bg-popover, not bg-card: --card is 2% white and this sits over a
            scrim, so the old card was effectively transparent. */}
        <div className="rounded-full border border-border bg-popover px-3.5 py-2 text-[13px] font-medium text-ok">
          ✓ Done
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[400px] overflow-hidden rounded-2xl border border-border bg-popover shadow-[var(--raise-lg)]">
        <div className="flex items-center gap-1.5 border-b border-border-soft px-4 py-2.5 font-mono text-[10px] lowercase tracking-wide text-warn">
          ⚡ confirm: {pending.summary}
        </div>
        {errorMsg && (
          <div className="px-4 py-1.5 text-[13px] text-crit">{errorMsg}</div>
        )}
        <div className="flex gap-2 px-3 py-2">
          <button
            onClick={handleConfirm}
            disabled={state === "loading"}
            className="flex-1 cursor-pointer rounded-full bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state === "loading" ? "Applying…" : "Approve"}
          </button>
          <button
            onClick={onDismiss}
            disabled={state === "loading"}
            className="flex-1 cursor-pointer rounded-full border border-border-soft px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed"
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
          className="min-w-0 flex-1 rounded-lg border border-border bg-secondary px-2 py-0.5 font-[inherit] text-[13px] text-foreground outline-none"
        />
      ) : (
        <div
          onClick={onSelect}
          className={`min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap text-[13px] ${isActive ? "text-foreground" : "text-muted-foreground"}`}
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
        className="shrink-0 cursor-pointer rounded-full border-none bg-transparent px-1 py-0.5 text-[11px] text-dim transition-colors hover:text-foreground"
      >
        ✏
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        className="shrink-0 cursor-pointer rounded-full border-none bg-transparent px-1 py-0.5 text-[11px] text-dim transition-colors hover:text-foreground"
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
        className="fixed bottom-[88px] right-6 z-[1000] flex cursor-pointer items-center gap-2 rounded-full border border-border bg-popover px-4 py-2.5 text-[13px] font-medium tracking-[0.01em] text-foreground shadow-[var(--raise-lg)] transition-colors hover:border-foreground/20 hover:bg-secondary"
      >
        <span className="text-[15px]">✦</span>
        <span>DevOps AI</span>
        {open && <span className="ml-0.5 text-[11px] text-dim">✕</span>}
      </button>

      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[1001] bg-black/60 backdrop-blur-[2px]"
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
              !historyOpen && "border-b border-border-soft",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[15px] text-muted-foreground">✦</span>
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-mono text-[10px] lowercase tracking-wide text-dim hover:text-foreground"
              >
                DevOps Assistant
                <span className="text-[9px] text-dim">
                  {historyOpen ? "▲" : "▼"}
                </span>
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="cursor-pointer rounded-full border-none bg-transparent px-1.5 py-0.5 text-[16px] leading-none text-muted-foreground transition-colors hover:text-foreground"
            >
              ✕
            </button>
          </div>

          {/* History dropdown */}
          {historyOpen && (
            <div className="max-h-60 overflow-y-auto border-b border-border-soft bg-background">
              <button
                onClick={handleNewConversation}
                className="w-full cursor-pointer border-none border-b border-border-soft bg-transparent px-4 py-2 text-left font-[inherit] text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                + New conversation
              </button>
              {conversations.length === 0 && (
                <div className="px-4 py-[10px] text-[13px] text-dim">
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
            <div className="mt-10 text-center text-[13px] leading-relaxed">
              <div className="mb-3 text-[28px] text-dim">✦</div>
              <div className="mb-1.5 font-medium text-foreground">
                Ask about your infrastructure
              </div>
              <div className="text-muted-foreground">
                Open incidents, drifts, recent deploys,
                <br />
                usage — I can help.
              </div>
            </div>
          )}
          {visibleMessages.length === 0 && loading && (
            <div className="mt-10 text-center text-[13px] leading-relaxed">
              <div className="mb-3 text-[28px] text-dim">✦</div>
              <div className="text-muted-foreground">
                Analyzing your infrastructure…
              </div>
            </div>
          )}

          {visibleMessages.map((msg, idx) => (
            <div key={idx}>
              {msg.role === "user" ? (
                <div className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl border border-border-soft bg-secondary px-3.5 py-2 text-[13px] leading-[1.5] text-foreground">
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
                      className="mt-2 w-full cursor-pointer rounded-xl border border-warn/30 px-3 py-1.5 text-left font-mono text-[10px] lowercase tracking-wide text-warn transition-colors hover:bg-warn/10"
                    >
                      ⚡ needs approval: {msg.pending.summary}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="text-[13px] italic text-dim">Thinking…</div>
          )}
        </div>

        {/* Quota exceeded */}
        {quotaExceeded && (
          <div className="mx-4 mb-2.5 shrink-0 rounded-xl border border-crit/30 px-3 py-2 text-[13px] text-crit">
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
            className="flex-1 resize-none rounded-xl border border-border bg-secondary px-3 py-2 font-[inherit] text-[13px] leading-[1.5] text-foreground outline-none placeholder:text-dim focus:ring-1 focus:ring-ring disabled:opacity-50"
            onInput={(e) => {
              const t = e.currentTarget;
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading || quotaExceeded}
            className="shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
