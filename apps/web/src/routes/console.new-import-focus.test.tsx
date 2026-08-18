// @vitest-environment jsdom
//
// Regression test for the auto-focus-on-import-intent behaviour in
// console.new.tsx: someone arriving with import intent (an SEO guide's CTA
// seeding lib/pendingImport, or a `?import=` link) must land with the cursor
// already in the field that takes a repo.
//
// What this test used to also guard, and deliberately no longer does: the
// screen was two Radix tabs, and TabsContent mounts its children through its
// own Presence state machine in a useLayoutEffect the parent's effects cannot
// observe. A focus effect keyed on the active tab could therefore run before
// the field existed and never get a second chance. Both panes carried
// `forceMount` because of it. PR 5 replaced the tabs with a single always-
// mounted filter field (the repo list is the screen), so that race
// has no surface left. The assertions about tab state went with it.
//
// The "no session" case is still the sharper of the two: with no session the
// repos fetch never fires, so there is no incidental later re-render that
// could rescue a focus effect that ran too early.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { setPendingImport } from "../lib/pendingImport";

// Node's own experimental `globalThis.localStorage` shadows jsdom's and
// throws without a --localstorage-file flag. setPendingImport swallows that
// by design (private-mode Safari), so without this stub the write silently
// no-ops and the effect under test never fires.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// "mock"-prefixed per Vitest's hoisting rule: vi.mock's factory is hoisted
// above these declarations, and Vitest special-cases identifiers starting
// with "mock" so they can still be referenced from inside it.
const mockGetGitHubRepos = vi.fn();

let mockSession: { user: { id: string; email: string } } | null = null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

// The console shell (top bar, sidebar nav, notification polling) is a large
// tree with its own route/auth/data wiring that has nothing to do with the
// focus behaviour under test.
vi.mock("./console", () => ({
  ConsoleTopBar: () => null,
}));

vi.mock("../context/auth", () => ({
  useAuth: () => ({ session: mockSession }),
}));

vi.mock("../lib/api", () => ({
  sendChat: vi.fn(),
  getConnectedServices: vi.fn(),
  analyzeRepoForStack: vi.fn(),
  getGitHubRepos: (...args: unknown[]) => mockGetGitHubRepos(...args),
  importNode: vi.fn(),
  saveEnvCanvas: vi.fn(),
  checkConnectionHealth: vi.fn().mockResolvedValue({}),
  startOAuthFlow: vi.fn(),
  getRepoSummaries: vi.fn().mockResolvedValue({}),
}));

const FILTER_PLACEHOLDER = "Filter repos, or paste a GitHub URL…";

async function renderNewStackPage() {
  const mod = (await import("./console.new")) as unknown as {
    Route: { component: React.ComponentType };
  };
  const Page = mod.Route.component;
  return render(<Page />);
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; harmless to stub unconditionally
  // even though the repo-first branch never calls it (bottomRef only exists
  // in the chat branch).
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("localStorage", memoryStorage());
  mockSession = null;
  mockGetGitHubRepos.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("console.new.tsx — import-intent auto-focus", () => {
  it("focuses the repo field with no session at all", async () => {
    setPendingImport("lovable");

    await renderNewStackPage();

    await waitFor(() => {
      const field = screen.getByPlaceholderText(FILTER_PLACEHOLDER);
      expect(document.activeElement).toBe(field);
    });
  });

  it("keeps focus in the repo field after the repos fetch resolves", async () => {
    // The old version of this test needed the fetch to resolve before focus
    // could land. It must now be irrelevant: focus is already there, and a
    // later re-render must not steal it back.
    mockSession = { user: { id: "u1", email: "founder@example.com" } };
    mockGetGitHubRepos.mockResolvedValue([
      {
        id: 1,
        full_name: "acme/app",
        name: "app",
        html_url: "https://github.com/acme/app",
        private: false,
        description: null,
        updated_at: "2026-08-18T00:00:00.000Z",
        pushed_at: "2026-08-18T00:00:00.000Z",
        default_branch: "main",
      },
    ]);
    setPendingImport("lovable");

    await renderNewStackPage();

    await waitFor(() => expect(screen.getByText("acme/app")).toBeTruthy());
    expect(document.activeElement).toBe(
      screen.getByPlaceholderText(FILTER_PLACEHOLDER),
    );
  });

  it("renders the connect prompt when there is no repo list", async () => {
    // The state every first-time user is in. Because the page IS the repo
    // list, this is not an edge case — it is the default first view.
    await renderNewStackPage();

    await waitFor(() =>
      expect(
        screen.getByText("Connect GitHub to bring an app you already built"),
      ).toBeTruthy(),
    );
  });
});
