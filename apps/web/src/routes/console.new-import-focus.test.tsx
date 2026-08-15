// @vitest-environment jsdom
//
// Regression test for the auto-focus-on-import-intent behaviour in
// console.new.tsx: when someone arrives with import intent (an SEO guide's
// CTA seeding lib/pendingImport, or a `?import=` link), the empty state must
// switch to the "import" tab AND land focus in the repo control, in the same
// pass — not as two separate things that happen to line up.
//
// Why this needs a real render rather than a source-text guard (the pattern
// console.new.test.ts uses): the bug this guards against is a *timing* bug
// in how React and Radix's TabsContent commit, not something visible in the
// source text. Radix's TabsContent mounts its children via its own internal
// Presence state machine, which (without `forceMount`) transitions
// "unmounted" -> "mounted" in a `useLayoutEffect` local to that component —
// a commit this component's own effects don't observe. A focus effect in
// NewStackPage that depends on `activeTab` can run in an *earlier* commit,
// before that DOM node exists, and never gets a second chance to run unless
// something unrelated happens to re-render NewStackPage afterwards.
//
// Before the fix, that "something unrelated" existed by accident: the
// GitHub-repos fetch's `setReposLoading(false)` (a real, separately-motivated
// re-render) coincidentally re-ran the focus effect after Radix had finished
// its own mount. The "repos loaded" test below still exercises that async
// path end-to-end. The "no session" test is the one that isolates the actual
// bug: with no session, the repos fetch never fires, so there is no
// accidental second render to paper over a broken mount race — this is the
// case that would fail if TabsContent went back to conditional (un)mounting
// instead of `forceMount` + CSS-driven visibility.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { setPendingImport } from "../lib/pendingImport";

// Node's own experimental `globalThis.localStorage` (active by default on
// recent Node) shadows jsdom's real implementation and throws without a
// --localstorage-file flag — see GuideLayout.test.tsx, which hit the same
// thing. setPendingImport/takePendingImport both swallow that in a try/catch
// (by design, for private-mode Safari etc.), so without this stub the write
// silently no-ops and the import-intent effect never fires — the test would
// fail for a reason that has nothing to do with the behaviour under test.
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

// Mutable so each test can hand back a different session without redefining
// the mock module. The factory below isn't invoked until useAuth() actually
// runs (during render), by which point the test has already set this.
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
// tab/focus behaviour under test.
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
}));

async function renderNewStackPage() {
  const mod = (await import("./console.new")) as unknown as {
    Route: { component: React.ComponentType };
  };
  const Page = mod.Route.component;
  return render(<Page />);
}

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; harmless to stub unconditionally
  // even though the empty state never actually calls it (bottomRef only
  // exists in the non-empty "Chat state" branch).
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
  it("focuses the plain URL input when import intent arrives and there is no session-scoped repo list", async () => {
    // No session -> the GitHub-repos fetch effect never fires -> reposLoading
    // stays false and githubRepos stays null for the entire test, so there is
    // no later, unrelated re-render available to accidentally rescue a
    // broken focus effect. If this passes, the fix is doing the work, not a
    // side effect of some other state change.
    setPendingImport("lovable");

    await renderNewStackPage();

    await waitFor(() => {
      const input = screen.getByPlaceholderText(
        "https://github.com/you/your-repo",
      );
      expect(document.activeElement).toBe(input);
    });

    // And the tab actually switched — auto-focus without the tab switch
    // would just be focusing something invisible.
    expect(
      screen
        .getByRole("tab", { name: "I already built something" })
        .getAttribute("data-state"),
    ).toBe("active");
  });

  it("focuses the loaded-repos select once the GitHub repos fetch resolves", async () => {
    mockSession = { user: { id: "u1", email: "founder@example.com" } };
    mockGetGitHubRepos.mockResolvedValue([
      {
        id: 1,
        full_name: "acme/app",
        html_url: "https://github.com/acme/app",
        private: false,
      },
    ]);
    setPendingImport("lovable");

    await renderNewStackPage();

    await waitFor(() => {
      const select = screen.getByRole("combobox");
      expect(document.activeElement).toBe(select);
    });
    expect(screen.getByText("acme/app")).toBeTruthy();
  });
});
