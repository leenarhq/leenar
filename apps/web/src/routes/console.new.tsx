import { useState, useRef, useEffect, useCallback } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { ConsoleTopBar } from "./console";
import ChatMarkdown from "../components/chat/ChatMarkdown";
import { useAuth } from "../context/auth";
import {
  sendChat,
  getConnectedServices,
  analyzeRepoForStack,
  getGitHubRepos,
  type ChatMessage,
  type StackProposal,
  type GitHubRepo,
} from "../lib/api";
import {
  createChatConversation,
  saveChatHistory,
  loadChatHistory,
} from "../lib/workflows";
import { createProject } from "../lib/workflows";
import { ENV_FLOW } from "../lib/envFlow";
import { takePendingPrompt } from "../lib/pendingPrompt";
import {
  applyAutoLayout,
  inferServiceType,
} from "../components/canvas/workspaceHelpers";

/* ── Route ──────────────────────────────────────────────────── */

export const Route = createFileRoute("/console/new")({
  head: () => ({
    meta: [{ title: "New Project — Leenar Console" }],
  }),
  validateSearch: (search: Record<string, unknown>): { chatId?: string } => {
    const id =
      typeof search.chatId === "string" && search.chatId
        ? search.chatId
        : undefined;
    return id !== undefined ? { chatId: id } : {};
  },
  component: NewStackPage,
});

/* ── Service brand config (reused from Templates) ───────────── */

const SVC: Record<
  string,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  github: {
    label: "GitHub",
    color: "var(--provider-github)",
    bg: "rgba(201,209,217,0.1)",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    ),
  },
  vercel: {
    label: "Vercel",
    color: "var(--provider-vercel)",
    bg: "rgba(180,180,180,0.14)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M12 2L2 19.5h20L12 2z" />
      </svg>
    ),
  },
  supabase: {
    label: "Supabase",
    color: "#3ecf8e",
    bg: "rgba(62,207,142,0.1)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.111 12.888.749 14 1.814 14h9.196l.183 10.964c.015.986 1.26 1.41 1.874.637l9.262-11.652c.653-.837.015-1.949-1.05-1.949h-9.196L11.9 1.036z" />
      </svg>
    ),
  },
  resend: {
    label: "Resend",
    color: "#f97316",
    bg: "rgba(249,115,22,0.1)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M3 3h18a1 1 0 011 1v.333L12 13 2 4.333V4a1 1 0 011-1zm-1 3.4V20a1 1 0 001 1h18a1 1 0 001-1V6.4l-10 8.6L2 6.4z" />
      </svg>
    ),
  },
  cloudflare: {
    label: "Cloudflare",
    color: "#f6821f",
    bg: "rgba(246,130,31,0.1)",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M16.5 15.5c.3-1 .2-1.9-.3-2.5-.4-.5-1.1-.8-1.9-.9l-8.3-.1c-.1 0-.2-.1-.2-.2s.1-.2.2-.2l8.4-.1c1-.1 2.1-.9 2.5-1.9l.5-1.2c0-.1 0-.2-.1-.3C16.6 5.8 14.4 4 11.8 4 9.5 4 7.5 5.3 6.5 7.2c-.5-.4-1.2-.6-1.9-.5C3.2 6.9 2 8.3 2 9.7v.1C.8 10.1 0 11.2 0 12.5 0 14 1.2 15.2 2.7 15.2H16c.2 0 .4-.1.5-.3l.4-.4.-.4zM19.3 9.5c-.1 0-.2 0-.3 0-.1 0-.1 0-.2 0-.1-.5-.3-1-.6-1.5l-.1-.2h-.2c-.2 0-.4.1-.5.3-.1.2-.1.4 0 .6.2.3.3.7.4 1.1v.1c0 .2.1.3.3.4.1 0 .2 0 .3 0C20.3 10.4 21 11.1 21 12c0 .9-.7 1.6-1.6 1.6H18c-.3 0-.5.2-.5.5s.2.5.5.5h1.4C21.1 14.6 22.5 13.4 22.5 12c0-1.3-1-2.4-2.3-2.5H19.3z" />
      </svg>
    ),
  },
};

const SERVICE_LABELS: Record<string, string> = {
  github: "GitHub",
  vercel: "Vercel",
  supabase: "Supabase",
  resend: "Resend",
  cloudflare: "Cloudflare",
};

/* ── proposalToCanvas ───────────────────────────────────────── */

const SERVICE_NODE_MAP: Record<
  string,
  { label: string; iconName: string; nodeType: string }
> = {
  github: { label: "GitHub", iconName: "Github", nodeType: "service" },
  vercel: { label: "Vercel", iconName: "Triangle", nodeType: "service" },
  supabase: { label: "Supabase", iconName: "Database", nodeType: "service" },
  resend: { label: "Resend", iconName: "Send", nodeType: "service" },
  cloudflare: {
    label: "Cloudflare",
    iconName: "Cloudflare",
    nodeType: "service",
  },
};

function proposalToCanvas(proposal: StackProposal) {
  const ts = Date.now();
  const githubRepoUrl = proposal.services.find(
    (s) => s.service_type === "github",
  )?.existing_repo;

  const nodes = proposal.services.map((svc, i) => {
    const meta = SERVICE_NODE_MAP[svc.service_type] ?? {
      label: svc.service_type,
      iconName: "Box",
      nodeType: "service",
    };
    const repoUrl =
      svc.service_type === "vercel"
        ? (svc.existing_repo ?? githubRepoUrl ?? null)
        : (svc.existing_repo ?? null);
    return {
      id: `${svc.service_type}-${ts}-${i}`,
      type: meta.nodeType,
      position: { x: 120 + i * 280, y: 220 },
      data: {
        label: meta.label,
        iconName: meta.iconName,
        provider: svc.service_type,
        ...(repoUrl ? { existing_repo: repoUrl } : {}),
      },
    };
  });

  const edges = proposal.connections
    .map((conn, i) => {
      const srcNode = nodes.find((n) => n.data.provider === conn.from_type);
      const tgtNode = nodes.find((n) => n.data.provider === conn.to_type);
      if (!srcNode || !tgtNode) return null;
      const fromKey =
        inferServiceType(srcNode.data as Record<string, unknown>) ??
        conn.from_type;
      const toKey =
        inferServiceType(tgtNode.data as Record<string, unknown>) ??
        conn.to_type;
      const wired = (ENV_FLOW[fromKey]?.[toKey]?.length ?? 0) > 0;
      return {
        id: `edge-${ts}-${i}`,
        source: srcNode.id,
        target: tgtNode.id,
        type: "blueprint",
        animated: false,
        // Leave envVars empty: backend resolves ENV_FLOW + framework at provision
        // time. Freezing names here would be treated as a user override.
        data: {},
        markerEnd: {
          type: "arrowclosed",
          color: wired ? "#34d399" : "var(--app-accent)",
        },
      };
    })
    .filter(Boolean);

  return { nodes: applyAutoLayout(nodes as any, edges as any), edges };
}

/* ── aiAsksForGitHubRepo ────────────────────────────────────── */

function aiAsksForGitHubRepo(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    (lower.includes("github") || lower.includes("repo")) &&
    (lower.includes("have") ||
      lower.includes("already") ||
      lower.includes("existing") ||
      lower.includes("url") ||
      lower.includes("link") ||
      lower.includes("do you"))
  );
}

/* ── ProposalCard ───────────────────────────────────────────── */

function ProposalCard({
  proposal,
  onApprove,
  missingConnections,
  approving,
}: {
  proposal: StackProposal;
  onApprove: () => void;
  missingConnections: string[];
  approving: boolean;
}) {
  const hasMissing = missingConnections.length > 0;

  return (
    <div className="my-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-shadow duration-150 hover:shadow-md">
      <div className="p-5 border-b border-border">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
          Proposal
        </div>
        <div className="text-base font-semibold">{proposal.name}</div>
        <div className="mt-1.5 text-sm text-muted-foreground">
          {proposal.summary}
        </div>
      </div>

      <div className="p-5 flex flex-wrap gap-2">
        {proposal.services.map((svc) => {
          const cfg = SVC[svc.service_type];
          return (
            <span
              key={svc.service_type}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-transform duration-150 hover:scale-[1.03]"
              style={{
                background: cfg?.bg,
                borderColor: cfg ? `${cfg.color}40` : undefined,
                color: cfg?.color,
              }}
            >
              {cfg?.icon}
              {svc.display_name ||
                SERVICE_LABELS[svc.service_type] ||
                svc.service_type}
            </span>
          );
        })}
      </div>

      {proposal.connections.length > 0 && (
        <div className="px-5 pb-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Connections
          </div>
          <div className="space-y-1.5">
            {proposal.connections.map((conn, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary/30"
              >
                <span className="font-medium text-foreground">
                  {SERVICE_LABELS[conn.from_type] ?? conn.from_type}
                </span>
                <span className="text-muted-foreground/70">→</span>
                <span className="font-medium text-foreground">
                  {SERVICE_LABELS[conn.to_type] ?? conn.to_type}
                </span>
                {conn.env_var_name && (
                  <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-mono">
                    {conn.env_var_name}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasMissing && (
        <div className="mx-5 mb-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
          ⚠ {missingConnections.map((s) => SERVICE_LABELS[s] ?? s).join(" & ")}{" "}
          {missingConnections.length === 1 ? "is" : "are"} not connected yet.{" "}
          <Link
            to="/console/integrations"
            className="underline hover:text-yellow-300"
          >
            Connect in Integrations →
          </Link>
        </div>
      )}

      <div className="px-5 pb-5">
        <button
          onClick={onApprove}
          disabled={approving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-150 hover:shadow-md hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:hover:brightness-100"
        >
          {approving ? (
            "Creating project…"
          ) : (
            <>
              Open in Canvas
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Typing indicator ───────────────────────────────────────── */

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  );
}

/* ── NewStackPage ───────────────────────────────────────────── */

// A chat message that may carry an embedded proposal. Embedding the
// proposal directly on the message (rather than persisting a raw array
// index) keeps it correct across saves/reloads even if the message array
// shifts — see StoredChatMessage in lib/workflows.ts.
type NewChatMessage = ChatMessage & {
  proposal?: StackProposal;
  // true if this message's own content should be hidden from the transcript
  // because the ProposalCard already represents it (mirrors the old
  // proposalMsgIdx-hides-a-message behavior).
  proposalHidesMessage?: boolean;
};

function NewStackPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const { chatId } = Route.useSearch();

  const [messages, setMessages] = useState<NewChatMessage[]>([]);
  const [proposal, setProposal] = useState<StackProposal | null>(null);
  const [proposalMsgIdx, setProposalMsgIdx] = useState<number | null>(null);
  const [proposalSplitAt, setProposalSplitAt] = useState<number | null>(null);
  const [missingConnections, setMissingConnections] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);

  const reposFetchedRef = useRef(false);
  const draftWorkflowIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Fetch user's GitHub repos once
  useEffect(() => {
    if (!session || reposFetchedRef.current) return;
    reposFetchedRef.current = true;
    setReposLoading(true);
    getGitHubRepos(session)
      .then(setGithubRepos)
      .catch(() => setGithubRepos(null))
      .finally(() => setReposLoading(false));
  }, [session]);

  // Load existing chat when chatId is in URL
  useEffect(() => {
    if (!chatId || !session || messages.length > 0) return;
    draftWorkflowIdRef.current = chatId;
    loadChatHistory(chatId)
      .then((history) => {
        if (!history.length) return;
        const restored = history as NewChatMessage[];
        setMessages(restored);

        // Re-derive proposal/proposalMsgIdx/proposalSplitAt from whichever
        // message carries the embedded proposal, rather than trusting a
        // persisted raw index (which would go stale if the array shifted).
        // Scan from the end (not findIndex from the start): older messages
        // may still carry a stale embedded .proposal from an earlier
        // proposal in the same conversation (embedding never clears prior
        // owners), so the most recent message with a proposal is the one
        // that reflects live in-session state.
        let idx = -1;
        for (let i = restored.length - 1; i >= 0; i--) {
          if (restored[i].proposal) {
            idx = i;
            break;
          }
        }
        if (idx !== -1) {
          const owner = restored[idx];
          setProposal(owner.proposal ?? null);
          setProposalSplitAt(idx + 1);
          setProposalMsgIdx(owner.proposalHidesMessage ? idx : null);
          if (owner.proposal) {
            const neededServices = owner.proposal.services.map(
              (s) => s.service_type,
            );
            getConnectedServices(session)
              .then((connected) => {
                const missing = neededServices.filter(
                  (svc) => !connected.includes(svc),
                );
                setMissingConnections(missing);
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, [chatId, session]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const sendText = useCallback(
    async (text: string) => {
      if (!text || loading || !session) return;

      const next: NewChatMessage[] = [
        ...messages,
        { role: "user", content: text },
      ];
      setMessages(next);
      setInput("");
      setLoading(true);
      setError(null);

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      try {
        // Strip local-only fields before sending to the API
        const apiMessages: ChatMessage[] = next.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const res = await sendChat(apiMessages, session, "new");
        if (res.quotaExceeded) {
          setError(
            res.error ?? "Daily AI limit reached. Resets at midnight UTC.",
          );
          setLoading(false);
          return;
        }

        let allMessages: NewChatMessage[] = res.reply
          ? [...next, { role: "assistant" as const, content: res.reply }]
          : next;

        if (res.proposal) {
          // Embed the proposal on whichever message it "belongs" to: the
          // fresh assistant reply if there is one (and hide that message's
          // own content, since ProposalCard represents it), otherwise the
          // last existing message (nothing hidden).
          const ownerIdx = allMessages.length - 1;
          allMessages = allMessages.map((m, i) =>
            i === ownerIdx
              ? {
                  ...m,
                  proposal: res.proposal,
                  proposalHidesMessage: !!res.reply,
                }
              : m,
          );
        }

        if (res.reply || res.proposal) {
          setMessages(allMessages);
        }

        // Persist chat history
        if (!draftWorkflowIdRef.current) {
          createChatConversation(text.slice(0, 60) || "New conversation")
            .then((wf) => {
              draftWorkflowIdRef.current = wf.id;
              saveChatHistory(wf.id, allMessages).catch(() => {});
              navigate({
                to: "/console/new",
                search: { chatId: wf.id },
                replace: true,
              });
            })
            .catch(() => {});
        } else {
          saveChatHistory(draftWorkflowIdRef.current, allMessages).catch(
            () => {},
          );
        }

        if (res.proposal) {
          const replyIdx = res.reply ? next.length : null;
          setProposalMsgIdx(replyIdx);
          setProposalSplitAt(next.length + (res.reply ? 1 : 0));
          setProposal(res.proposal);
          if (session) {
            const neededServices = res.proposal.services.map(
              (s) => s.service_type,
            );
            getConnectedServices(session)
              .then((connected) => {
                const missing = neededServices.filter(
                  (svc) => !connected.includes(svc),
                );
                setMissingConnections(missing);
              })
              .catch(() => {});
          }
        }
      } catch (e) {
        setError((e as Error).message || "Something went wrong.");
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, session, navigate],
  );

  const importFromRepo = useCallback(async () => {
    const url = repoUrl.trim();
    if (!url || repoLoading || !session) return;
    setRepoLoading(true);
    setRepoError(null);
    try {
      const result = await analyzeRepoForStack(url, session);
      const p = result.proposal as StackProposal;
      setProposal(p);
      setProposalSplitAt(2);
      setProposalMsgIdx(null);
      setMessages([
        { role: "user", content: `Import from GitHub: ${url}` },
        {
          role: "assistant",
          content: `Analyzed \`${result.repoFullName}\` — detected ${p.services.map((s) => s.display_name).join(", ")}. Review the proposal below.`,
          proposal: p,
          proposalHidesMessage: false,
        },
      ]);
      if (session) {
        const neededServices = p.services.map((s) => s.service_type);
        getConnectedServices(session)
          .then((connected) => {
            const missing = neededServices.filter(
              (svc) => !connected.includes(svc),
            );
            setMissingConnections(missing);
          })
          .catch(() => {});
      }
    } catch (e) {
      setRepoError(
        (e as Error).message ||
          "Failed to analyze repo. Make sure it's a public GitHub repo.",
      );
    } finally {
      setRepoLoading(false);
    }
  }, [repoUrl, repoLoading, session]);

  const send = useCallback(() => sendText(input.trim()), [input, sendText]);

  /**
   * A prompt typed into the landing hero before signing in. It arrives via
   * sessionStorage (see lib/pendingPrompt) because the trip here can detour
   * through sign-up and an OAuth provider. Sent as if it had been typed in the
   * box below — the visitor already pressed Enter on it once.
   *
   * Guarded by a ref as well as the read-once take(), because this runs again
   * as soon as `sendText` changes identity, which it does on every message.
   */
  const pendingSentRef = useRef(false);
  useEffect(() => {
    if (!session || chatId || pendingSentRef.current) return;
    const prompt = takePendingPrompt();
    if (!prompt) return;
    pendingSentRef.current = true;
    void sendText(prompt);
  }, [session, chatId, sendText]);

  const approve = useCallback(async () => {
    if (!proposal || approving) return;
    setApproving(true);
    try {
      const canvas = proposalToCanvas(proposal);
      const project = await createProject(proposal.name, canvas as any);

      navigate({
        to: "/console/projects/$id/canvas",
        params: { id: project.id },
      });
    } catch (e) {
      setError((e as Error).message || "Failed to create project.");
      setApproving(false);
    }
  }, [proposal, approving, navigate]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const isEmpty = messages.length === 0;

  const SUGGESTIONS = [
    "SaaS with auth, email & file storage",
    "Next.js app with Supabase + Resend",
    "Edge API with Cloudflare Workers + Supabase",
    "Deploy a full-stack app to Vercel",
  ];

  const firstName =
    (session?.user?.user_metadata?.full_name as string | undefined)?.split(
      " ",
    )[0] ??
    session?.user?.email?.split("@")[0] ??
    null;

  return (
    <>
      <ConsoleTopBar title="New Project" />
      <div className="flex flex-1 flex-col overflow-hidden">
        {isEmpty ? (
          /* ── Hero / empty state ── */
          <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-6 py-12">
            <div className="w-full max-w-2xl">
              {/* Badge */}
              <div className="mb-6 flex items-center justify-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI-powered stack builder
                </div>
              </div>

              <h1 className="mb-2 text-center font-serif text-3xl">
                {firstName
                  ? `Got an idea, ${firstName}?`
                  : "What are you building?"}
              </h1>
              <p className="mb-8 text-center text-sm text-muted-foreground">
                Describe your project in plain English — the AI will propose an
                infrastructure stack.
              </p>

              {/* Suggestion chips */}
              <div className="mb-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendText(suggestion)}
                    disabled={loading}
                    className="rounded-full border border-border bg-secondary/30 px-3 py-1.5 text-xs text-muted-foreground shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--app-accent)]/40 hover:bg-secondary/60 hover:text-foreground hover:shadow disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>

              {/* Chat input card */}
              <div
                data-tour="chat"
                className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow duration-150 focus-within:border-[var(--app-accent)]/50 focus-within:ring-2 focus-within:ring-[var(--app-accent)]/20"
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  placeholder="Describe your project — e.g. a SaaS app with auth, database and email…"
                  rows={3}
                  onChange={(e) => {
                    setInput(e.target.value);
                    autoResize();
                  }}
                  onKeyDown={onKey}
                  disabled={loading}
                  className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
                />
                <div className="mt-3 flex items-center justify-end">
                  <button
                    onClick={send}
                    disabled={!input.trim() || loading}
                    className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-sm transition-all duration-150 hover:opacity-90 hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  >
                    {loading ? (
                      "Thinking…"
                    ) : (
                      <>
                        Send
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M8 13V3M3 8l5-5 5 5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Import from GitHub */}
              <div className="mt-6">
                <div className="mb-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <div className="h-px flex-1 bg-border" />
                  <span>or import from GitHub</span>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="flex gap-2">
                  {reposLoading ? (
                    <div className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground/50">
                      Loading repos…
                    </div>
                  ) : githubRepos && githubRepos.length > 0 ? (
                    <select
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      disabled={repoLoading}
                      className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground focus:outline-none disabled:opacity-50"
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
                    <input
                      type="text"
                      placeholder="https://github.com/you/your-repo"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") importFromRepo();
                      }}
                      disabled={repoLoading}
                      className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
                    />
                  )}
                  <button
                    onClick={importFromRepo}
                    disabled={!repoUrl.trim() || repoLoading}
                    className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-xs hover:bg-secondary/80 disabled:opacity-50"
                  >
                    {repoLoading ? "Analyzing…" : "Analyze"}
                  </button>
                </div>
                {repoError && (
                  <p className="mt-2 text-xs text-red-400">{repoError}</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* ── Chat state ── */
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-auto px-6 py-6">
              <div className="mx-auto max-w-2xl space-y-4">
                {messages
                  .slice(0, proposalSplitAt ?? undefined)
                  .map((msg, i) => {
                    if (i === proposalMsgIdx) return null;
                    return (
                      <div
                        key={i}
                        className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-foreground text-background"
                              : "bg-card border border-border text-foreground"
                          }`}
                        >
                          {msg.role === "assistant" ? (
                            <ChatMarkdown content={msg.content} />
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    );
                  })}

                {proposal && (
                  <ProposalCard
                    proposal={proposal}
                    onApprove={approve}
                    missingConnections={missingConnections}
                    approving={approving}
                  />
                )}

                {proposalSplitAt !== null &&
                  messages.slice(proposalSplitAt).map((msg, i) => (
                    <div
                      key={proposalSplitAt + i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === "user"
                            ? "bg-foreground text-background"
                            : "bg-card border border-border text-foreground"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <ChatMarkdown content={msg.content} />
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>
                  ))}

                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-xl border border-border bg-card">
                      <TypingDots />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                    {error}
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Bottom input bar */}
            <div className="border-t border-dashed border-border px-6 py-4">
              <div className="mx-auto max-w-2xl">
                {/* GitHub repo picker when AI asks */}
                {!loading &&
                  !proposal &&
                  messages.length > 0 &&
                  messages[messages.length - 1]?.role === "assistant" &&
                  aiAsksForGitHubRepo(
                    messages[messages.length - 1]?.content ?? "",
                  ) &&
                  githubRepos &&
                  githubRepos.length > 0 && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2">
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Your repos
                      </span>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) sendText(val);
                        }}
                        className="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:outline-none"
                      >
                        <option value="" disabled>
                          Select a repository…
                        </option>
                        {githubRepos.map((r) => (
                          <option key={r.id} value={r.html_url}>
                            {r.full_name}
                            {r.private ? " 🔒" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => sendText("I don't have a repo yet")}
                        className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        No repo yet
                      </button>
                    </div>
                  )}

                <div className="flex items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-shadow duration-150 focus-within:border-[var(--app-accent)]/50 focus-within:ring-2 focus-within:ring-[var(--app-accent)]/20">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    placeholder="Reply…"
                    rows={1}
                    onChange={(e) => {
                      setInput(e.target.value);
                      autoResize();
                    }}
                    onKeyDown={onKey}
                    disabled={loading}
                    className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50"
                    style={{ maxHeight: 120, overflowY: "auto" }}
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || loading}
                    className="shrink-0 rounded-md bg-foreground p-1.5 text-background shadow-sm transition-all duration-150 hover:opacity-90 hover:shadow disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 13V3M3 8l5-5 5 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
