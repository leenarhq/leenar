import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { ConsoleTopBar } from "./console";
import ChatMarkdown from "../components/chat/ChatMarkdown";
import { useAuth } from "../context/auth";
import {
  sendChat,
  getConnectedServices,
  analyzeRepoForStack,
  getGitHubRepos,
  importNode,
  saveEnvCanvas,
  checkConnectionHealth,
  startOAuthFlow,
  getRepoSummaries,
  type ChatMessage,
  type StackProposal,
  type GitHubRepo,
  type RepoSummary,
  type BuilderInfo,
} from "../lib/api";
import { ImportReport } from "../components/console/ImportReport";
import { RepoGrid } from "../components/console/RepoGrid";
import { EmptyCell } from "../components/console/EmptyCell";
import { PromptStrip } from "../components/console/PromptStrip";
import { HairGrid, HairCell } from "../components/console/HairGrid";
import { INPUT, PILL, PILL_QUIET } from "../components/console/Field";
import { filterRepos, looksLikeRepoUrl } from "../lib/repos";
import {
  createChatConversation,
  saveChatHistory,
  loadChatHistory,
} from "../lib/workflows";
import { createProject } from "../lib/workflows";
import { remapCanvasNodeId } from "../lib/canvasNodeId";
import { takePendingPrompt } from "../lib/pendingPrompt";
import { takePendingImport } from "../lib/pendingImport";
import { track } from "../lib/monitoring";
import { applyAutoLayout } from "../components/canvas/workspaceHelpers";

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

// Brand colour is gone from this map: a row of five service chips in five
// hues is what left `ok`/`warn`/`crit` with nothing to say. The glyph and the
// label carry recognition. See the spec's D3.
const SVC: Record<string, { label: string; icon: React.ReactNode }> = {
  github: {
    label: "GitHub",
    icon: (
      <svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
      </svg>
    ),
  },
  vercel: {
    label: "Vercel",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M12 2L2 19.5h20L12 2z" />
      </svg>
    ),
  },
  supabase: {
    label: "Supabase",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.111 12.888.749 14 1.814 14h9.196l.183 10.964c.015.986 1.26 1.41 1.874.637l9.262-11.652c.653-.837.015-1.949-1.05-1.949h-9.196L11.9 1.036z" />
      </svg>
    ),
  },
  resend: {
    label: "Resend",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
        <path d="M3 3h18a1 1 0 011 1v.333L12 13 2 4.333V4a1 1 0 011-1zm-1 3.4V20a1 1 0 001 1h18a1 1 0 001-1V6.4l-10 8.6L2 6.4z" />
      </svg>
    ),
  },
  cloudflare: {
    label: "Cloudflare",
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
        // A Supabase backend the user already owns is adopted, not provisioned.
        // Only `imported` is authoring intent and belongs in the canvas JSON:
        // the ref, the status and the dashboard URL are runtime state, stripped
        // from every canvas write (RUNTIME_KEYS in useWorkflowPersistence,
        // RUNTIME_NODE_KEYS in canvasRuntime). Writing them here would survive
        // exactly until the first autosave. approve() below makes them durable
        // in project_env_node_state instead. Gated on supabase because only
        // Supabase services ever carry an existing_ref today, and a future
        // adapter's ref would mean something else entirely.
        ...(svc.service_type === "supabase" && svc.existing_ref
          ? { imported: true }
          : {}),
      },
    };
  });

  const edges = proposal.connections
    .map((conn, i) => {
      const srcNode = nodes.find((n) => n.data.provider === conn.from_type);
      const tgtNode = nodes.find((n) => n.data.provider === conn.to_type);
      if (!srcNode || !tgtNode) return null;
      return {
        id: `edge-${ts}-${i}`,
        source: srcNode.id,
        target: tgtNode.id,
        type: "blueprint",
        animated: false,
        // Leave envVars empty: backend resolves ENV_FLOW + framework at provision
        // time. Freezing names here would be treated as a user override.
        data: {},
        // No `color` — see BlueprintEdge: the arrowhead is derived.
        markerEnd: { type: "arrowclosed" },
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return { nodes: applyAutoLayout(nodes as any, edges as any), edges };
}

/** The Supabase project the analyzed repo already talks to AND the user
 *  provably owns. `/from-repo` sets `existing_ref` only for Supabase and only
 *  when ownership resolved to "user", so anything else is not adoptable. */
function adoptedSupabaseRef(proposal: StackProposal): string | null {
  return (
    proposal.services.find(
      (s) => s.service_type === "supabase" && s.existing_ref,
    )?.existing_ref ?? null
  );
}

/**
 * Stamp the adopted Supabase project's runtime keys onto one node.
 *
 * Used for the `projects.canvas` copy ONLY — the environment canvas keeps the
 * authoring shape proposalToCanvas emits. That asymmetry is deliberate and load
 * bearing; please don't "clean it up" by folding these keys back into
 * proposalToCanvas (they'd be stripped) or by dropping them here (a second,
 * empty Supabase project gets provisioned). Why the two sinks differ:
 *
 *  - `projects.canvas` is written exactly once, by createProject via supabase-js
 *    (lib/workflows.ts). A stripping write path to this row does exist —
 *    saveCanvasApi (lib/api.ts) → PATCH /api/projects/:id/canvas →
 *    stripRuntimeFromCanvas (workers/api/src/routes/workflowProvision.ts) — but
 *    it never fires in practice: every saveCanvasApi call site in
 *    useWorkflowPersistence.ts sits in the `else` branch of `if (envId)`, and a
 *    real project always has an environment row (the AFTER INSERT trigger in
 *    supabase/migrations/038_projects_rename.sql creates one), so autosave
 *    always takes the saveEnvCanvas branch instead. `deployWorkflow`
 *    (workers/api/src/deploy.ts, reached by the MCP `deploy_workflow` tool) and
 *    driftReprovision read that project row and never merge
 *    project_env_node_state, so unless the ref is in this JSON,
 *    `isAlreadyProvisioned` misses it and an agent-triggered deploy provisions
 *    a second, empty database beside the one the app already uses.
 *  - `project_environments.canvas` is round-tripped through the canvas endpoints
 *    on every autosave, which strip exactly these keys. There the durable truth
 *    is the project_env_node_state row approve() writes through POST
 *    /import-node, merged back onto the node at load time.
 */
function withAdoptedSupabaseRuntime<
  N extends { id: string; data: Record<string, unknown> },
  C extends { nodes: N[] },
>(canvas: C, nodeId: string, ref: string): C {
  return {
    ...canvas,
    nodes: canvas.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            data: {
              ...n.data,
              status: "provisioned",
              supabaseProjectRef: ref,
              provisionedUrl: `https://supabase.com/dashboard/project/${ref}`,
            },
          }
        : n,
    ),
  };
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

/**
 * What Approve is about to build.
 *
 * The env-key count sits here rather than on a repo cell. The mockup drew it
 * on the grid, but the number comes out of `analyzeRepo`
 * (workers/api/src/routes/workflowProvision.ts) — ~10 upstream requests per
 * repo behind a 20-per-5-minutes rate limit — so it cannot exist before a
 * repo has been picked. The reason for wanting it on the grid ("how heavy an
 * import is before you commit to it") is satisfied here anyway: this card is
 * the commitment.
 */
function ProposalCard({
  proposal,
  onApprove,
  missingConnections,
  approving,
  envKeyCount,
}: {
  proposal: StackProposal;
  onApprove: () => void;
  missingConnections: string[];
  approving: boolean;
  envKeyCount: number | null;
}) {
  const hasMissing = missingConnections.length > 0;

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-border">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[14.5px] font-medium tracking-[-0.01em]">
            {proposal.name}
          </div>
          {envKeyCount !== null && (
            <span className="shrink-0 font-mono text-[10.5px] lowercase tabular-nums text-dim">
              {envKeyCount} env {envKeyCount === 1 ? "key" : "keys"}
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[13px] text-muted-foreground">
          {proposal.summary}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-5 py-4">
        {proposal.services.map((svc) => {
          const cfg = SVC[svc.service_type];
          return (
            <span
              key={svc.service_type}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
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
          <div className="mb-2 font-mono text-[10px] lowercase tracking-wide text-dim">
            connections
          </div>
          <div className="space-y-1.5">
            {proposal.connections.map((conn, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[12px] text-muted-foreground"
              >
                <span className="text-foreground">
                  {SERVICE_LABELS[conn.from_type] ?? conn.from_type}
                </span>
                <span className="text-dim">→</span>
                <span className="text-foreground">
                  {SERVICE_LABELS[conn.to_type] ?? conn.to_type}
                </span>
                {conn.env_var_name && (
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                    {conn.env_var_name}
                  </code>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No warning glyph: the warn tone already says it, and a second
          signal for one state is what this system exists to stop. */}
      {hasMissing && (
        <div className="mx-5 mb-4 rounded-xl border border-warn/30 px-3 py-2 text-[12px] text-warn">
          {missingConnections.map((s) => SERVICE_LABELS[s] ?? s).join(" & ")}{" "}
          {missingConnections.length === 1 ? "is" : "are"} not connected yet.{" "}
          <Link
            to="/console/integrations"
            className="underline hover:text-foreground"
          >
            Connect in Integrations →
          </Link>
        </div>
      )}

      <div className="px-5 pb-5">
        <button onClick={onApprove} disabled={approving} className={PILL}>
          {approving ? "Creating project…" : "Open in Canvas"}
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
          className="h-1 w-1 rounded-full bg-dim animate-bounce"
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

/**
 * How many repos the grid scans, and how many per request.
 *
 * The cap is not politeness: each repo costs a GitHub API call plus up to four
 * raw fetches, and an account with 300 of them would spend a slice of its
 * hourly budget on a screen the user is about to click once. Repos past the
 * cap render plain — no chips, still clickable — which is the pre-PR-6 cell,
 * so the cap degrades rather than breaks.
 *
 * 40 was a first guess and the arithmetic did not support it. The GitHub cost
 * is one API call per repo against 5,000 an hour, and the batch mirrors the
 * server's MAX_REPOS, so what grows with the cap is the number of requests,
 * not the subrequests inside any one of them.
 *
 * That request count is the part to watch, because the server's rate limit on
 * this route counts requests: a full grid is ceil(cap / batch) of them, so
 * going to a hundred took a load from two requests to five and would have cut
 * a large account from ten grid loads per five minutes down to four. And the
 * loop below fires every batch at once and swallows a rejection, so reaching
 * the limit does not read as an error — it reads as a half-chipped grid, which
 * is the thing raising the cap was for. The limit moved with the cap
 * (SUMMARY_RATE_LIMIT, workers/api/src/routes/github.ts); change one and check
 * the other.
 */
const SUMMARY_CAP = 100;
const SUMMARY_BATCH = 20;

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
  const [builderInfo, setBuilderInfo] = useState<BuilderInfo | null>(null);
  const [envKeyCount, setEnvKeyCount] = useState<number | null>(null);
  const [summaries, setSummaries] = useState<Record<string, RepoSummary>>({});

  const reposFetchedRef = useRef(false);
  const draftWorkflowIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [wantsRepoFocus, setWantsRepoFocus] = useState(false);

  const [filter, setFilter] = useState("");
  const [prompt, setPrompt] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [githubAccount, setGithubAccount] = useState<string | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

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

  // Per-repo scan for the grid. Batched, and merged as each batch lands, so
  // the first twenty cells fill while the second twenty are still in flight.
  useEffect(() => {
    if (!session || !githubRepos?.length) return;
    const names = githubRepos.slice(0, SUMMARY_CAP).map((r) => r.full_name);
    let cancelled = false;
    for (let i = 0; i < names.length; i += SUMMARY_BATCH) {
      getRepoSummaries(names.slice(i, i + SUMMARY_BATCH), session)
        .then((batch) => {
          // Merge, never replace: two batches resolve in either order.
          if (!cancelled) setSummaries((prev) => ({ ...prev, ...batch }));
        })
        // A failed scan is a grid without chips, not a grid without repos.
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [session, githubRepos]);

  // `@login`, for the bar's right side. Best-effort: the grid works without
  // it, and connections/health is a slower call than the repo list.
  useEffect(() => {
    if (!session) return;
    checkConnectionHealth(session)
      .then((h) => setGithubAccount(h.github?.account ?? null))
      .catch(() => {});
  }, [session]);

  /**
   * Import intent carried from an SEO guide's CTA (e.g. "Try Leenar" on the
   * Lovable guide). Arrives via localStorage (see lib/pendingImport) because
   * the trip here can detour through sign-up and email confirmation, with a
   * direct `?import=` query param honoured too for anyone who lands here
   * from a shared link instead of clicking the CTA fresh.
   */
  const importIntentCheckedRef = useRef(false);
  useEffect(() => {
    if (importIntentCheckedRef.current) return;
    importIntentCheckedRef.current = true;
    const fromStorage = takePendingImport();
    const fromQuery = new URLSearchParams(window.location.search).get("import");
    // The tab switch this used to do is gone with the tabs: the filter field
    // is the paste-a-URL field and it is always mounted and always visible.
    if (fromStorage || fromQuery) setWantsRepoFocus(true);
  }, []);

  // Focus the one field that takes a repo. It is mounted from first render —
  // no Radix Presence commit to wait on any more, which is why this no longer
  // needs reposLoading/githubRepos in its deps. See the header of
  // console.new-import-focus.test.tsx.
  useEffect(() => {
    if (!wantsRepoFocus) return;
    filterRef.current?.focus();
    setWantsRepoFocus(false);
  }, [wantsRepoFocus]);

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
          // This proposal came from chat, not from a repo import — any
          // ImportReport left over from an earlier import no longer
          // describes what Approve is about to do, and neither does the
          // env-key count, which was counted from a different repo.
          setBuilderInfo(null);
          setEnvKeyCount(null);
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

  const importFromRepo = useCallback(
    async (explicitUrl?: string) => {
      const url = (explicitUrl ?? repoUrl).trim();
      if (!url || repoLoading || !session) return;
      setRepoLoading(true);
      setRepoError(null);
      try {
        const result = await analyzeRepoForStack(url, session);
        // Was fired on tab change; there are no tabs. Firing it on commitment
        // answers the same funnel question with intent rather than with clicks.
        track("new_project_path_selected", { path: "import" });
        track("repo_analyzed", {
          builder: result.builder?.name ?? null,
          backend_ownership: result.builder?.backendOwnership ?? null,
          env_style: result.builder?.envStyle ?? null,
        });
        const p = result.proposal as StackProposal;
        setProposal(p);
        setBuilderInfo(result.builder);
        // Already on the wire and thrown away until now. It cannot be shown on
        // a grid cell (that would need one analyzeRepo per repo, ~10 upstream
        // requests each, behind a 20-per-5-minutes limit) so it lands here,
        // on the card that is the actual commitment.
        setEnvKeyCount(result.detected_env_vars?.length ?? null);
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
    },
    [repoUrl, repoLoading, session],
  );

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
      const ref = adoptedSupabaseRef(proposal);
      const placeholderId = canvas.nodes.find(
        (n) => (n.data as { provider?: string }).provider === "supabase",
      )?.id;

      // `projects.canvas` is the only copy deployWorkflow / driftReprovision
      // ever read, and neither merges project_env_node_state — so the adopted
      // ref is stamped into that copy (and only that copy). See
      // withAdoptedSupabaseRuntime for why the environment canvas differs.
      const project = await createProject(
        proposal.name,
        (ref && placeholderId
          ? withAdoptedSupabaseRuntime(canvas, placeholderId, ref)
          : canvas) as any,
      );

      // Adopting the repo's existing Supabase project also has to survive in the
      // environment canvas, and there it cannot ride in the JSON: the ref and the
      // provisioned status are runtime keys, stripped by every autosave, so a
      // canvas-only marker is gone after one edit and Deploy would then create a
      // second, empty database. project_env_node_state is where that state lives,
      // and POST /import-node is the only path to it the web client can reach. It
      // mints the node id server-side, so the proposal canvas is rewritten around
      // the id it returns — replacing the whole env canvas, which also drops the
      // node import-node appended.
      // Best-effort: if any of it fails the canvas as created still stands and
      // the Supabase node simply provisions the ordinary way.
      if (ref && placeholderId && session) {
        try {
          const imported = await importNode(
            project.id,
            "supabase",
            ref,
            undefined,
            session,
          );
          await saveEnvCanvas(
            project.id,
            imported.envId,
            remapCanvasNodeId(canvas, placeholderId, imported.node.id),
            session,
            imported.canvas_version,
          );
        } catch {
          /* adoption failed — the project and its canvas are still valid */
        }
      }

      navigate({
        to: "/console/projects/$id/canvas",
        params: { id: project.id },
      });
    } catch (e) {
      setError((e as Error).message || "Failed to create project.");
      setApproving(false);
    }
  }, [proposal, approving, navigate, session]);

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
  /**
   * The third empty state: "Connected, no repo with a detectable app". The
   * grid still renders — dimmed — and the prompt strip takes the emphasis,
   * because building something new is the only move left.
   *
   * Computed over SCANNED repos only. Before the first batch lands nothing is
   * scanned, and `every` over an empty list is true — which would flash the
   * emphasis on every load.
   */
  const noAppAnywhere = useMemo(() => {
    const scanned = (githubRepos ?? []).filter((r) => summaries[r.full_name]);
    return (
      scanned.length > 0 && scanned.every((r) => !summaries[r.full_name].hasApp)
    );
  }, [githubRepos, summaries]);

  const visibleRepos = useMemo(
    () => filterRepos(githubRepos ?? [], filter),
    [githubRepos, filter],
  );

  return (
    <>
      <ConsoleTopBar
        title={
          <span className="flex items-center gap-2.5">
            New project
            {isEmpty && githubRepos && githubRepos.length > 0 && (
              <span className="font-mono text-[10px] tabular-nums text-dim">
                {githubRepos.length}
              </span>
            )}
          </span>
        }
        right={
          isEmpty && githubAccount ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {githubAccount}
            </span>
          ) : undefined
        }
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        {isEmpty ? (
          /* ── Repo-first: the repo list is the screen ── */
          <div className="flex-1 overflow-auto p-7">
            <div className="mx-auto max-w-[1000px]">
              <div className="relative mb-5">
                <input
                  ref={filterRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  onKeyDown={(e) => {
                    // One field, two jobs: filter as you type, or paste a URL
                    // and press Enter. There is no separate import entry
                    // point because the whole page is the import.
                    if (e.key === "Enter" && looksLikeRepoUrl(filter)) {
                      setRepoUrl(filter.trim());
                      void importFromRepo(filter.trim());
                    }
                  }}
                  placeholder="Filter repos, or paste a GitHub URL…"
                  className={INPUT}
                />
              </div>

              {reposLoading ? (
                <HairGrid cols={2}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <HairCell
                      key={i}
                      className="h-[104px] animate-pulse bg-card"
                    />
                  ))}
                </HairGrid>
              ) : !githubRepos ? (
                <EmptyCell
                  title="Connect GitHub to bring an app you already built"
                  body="leenar reads the repo to work out which services it needs. nothing is written back to it."
                  action={{
                    label: "Connect GitHub",
                    busy: connecting,
                    onClick: () => {
                      if (!session) return;
                      setConnecting(true);
                      startOAuthFlow("github", session, window.location.href)
                        .then((url) => {
                          window.location.href = url;
                        })
                        .catch(() => setConnecting(false));
                    },
                  }}
                />
              ) : githubRepos.length === 0 ? (
                <EmptyCell
                  title="No repositories on this account"
                  body="there is nothing to import yet — describe what you want to build instead and leenar will draw the stack."
                />
              ) : visibleRepos.length === 0 ? (
                <EmptyCell
                  title="No matching repositories"
                  body="try a different filter, or paste the repo's github url."
                />
              ) : (
                <RepoGrid
                  repos={visibleRepos}
                  summaries={summaries}
                  busy={repoLoading ? repoUrl : null}
                  onPick={(r) => {
                    setRepoUrl(r.html_url);
                    void importFromRepo(r.html_url);
                  }}
                />
              )}

              {repoError && (
                <p className="mt-3 text-[12px] text-crit">{repoError}</p>
              )}

              <PromptStrip
                value={prompt}
                onChange={setPrompt}
                onSubmit={() => {
                  const text = prompt.trim();
                  if (!text) return;
                  track("new_project_path_selected", { path: "idea" });
                  setPrompt("");
                  void sendText(text);
                }}
                disabled={loading}
                emphasised={
                  (!!githubRepos && githubRepos.length === 0) || noAppAnywhere
                }
              />
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
                          className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                            msg.role === "user"
                              ? "bg-secondary text-foreground"
                              : "border border-border text-foreground"
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

                {builderInfo && <ImportReport builder={builderInfo} />}

                {proposal && (
                  <ProposalCard
                    proposal={proposal}
                    onApprove={approve}
                    missingConnections={missingConnections}
                    approving={approving}
                    envKeyCount={envKeyCount}
                  />
                )}

                {proposalSplitAt !== null &&
                  messages.slice(proposalSplitAt).map((msg, i) => (
                    <div
                      key={proposalSplitAt + i}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed ${
                          msg.role === "user"
                            ? "bg-secondary text-foreground"
                            : "border border-border text-foreground"
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
                    <div className="rounded-2xl border border-border">
                      <TypingDots />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="rounded-xl border border-crit/30 px-3 py-2 text-[12px] text-crit">
                    {error}
                  </div>
                )}

                <div ref={bottomRef} />
              </div>
            </div>

            {/* Bottom input bar */}
            <div className="border-t border-border-soft px-6 py-4">
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
                    <div className="mb-3 flex items-center gap-2 rounded-xl border border-border px-3 py-2">
                      <span className="shrink-0 font-mono text-[11px] lowercase text-dim">
                        your repos
                      </span>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val) sendText(val);
                        }}
                        className="flex-1 rounded-lg border border-border-soft bg-secondary px-2 py-1.5 text-[12.5px] text-foreground focus:outline-none"
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
                        className={PILL_QUIET}
                      >
                        No repo yet
                      </button>
                    </div>
                  )}

                <div className="flex items-end gap-3 rounded-2xl border border-border px-4 py-3 transition-colors focus-within:border-foreground/25">
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
                    className="flex-1 resize-none bg-transparent text-[13.5px] text-foreground placeholder:text-dim focus:outline-none disabled:opacity-50"
                    style={{ maxHeight: 120, overflowY: "auto" }}
                  />
                  <button
                    onClick={send}
                    disabled={!input.trim() || loading}
                    className="shrink-0 rounded-full bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
