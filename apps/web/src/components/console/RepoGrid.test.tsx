// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RepoGrid } from "./RepoGrid";
import type { GitHubRepo, RepoSummary } from "../../lib/api";

// Vitest globals are off here, so RTL's auto-cleanup never registers.
afterEach(cleanup);

const repo = (name: string): GitHubRepo => ({
  id: name.length,
  full_name: `acme/${name}`,
  name,
  private: false,
  html_url: `https://github.com/acme/${name}`,
  description: null,
  updated_at: "2026-08-18T00:00:00.000Z",
  pushed_at: "2026-08-18T00:00:00.000Z",
  default_branch: "main",
});

const summary = (over: Partial<RepoSummary> = {}): RepoSummary => ({
  full_name: "acme/app",
  hasApp: true,
  envKeys: 14,
  services: ["github", "vercel", "supabase"],
  ...over,
});

describe("RepoGrid", () => {
  it("shows the env-key count and the stack, minus github", () => {
    render(
      <RepoGrid
        repos={[repo("app")]}
        summaries={{ "acme/app": summary() }}
        busy={null}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText("14 env keys")).toBeTruthy();
    expect(screen.getByText("vercel")).toBeTruthy();
    expect(screen.getByText("supabase")).toBeTruthy();
    // Every repo is on GitHub. A chip that is always there says nothing.
    expect(screen.queryByText("github")).toBeNull();
  });

  it("labels a workspace root, so its empty chip row is explained", () => {
    render(
      <RepoGrid
        repos={[repo("app")]}
        summaries={{
          // What the scan actually returns for a workspace root: it reads the
          // root package.json only, and that declares tooling, not a stack.
          "acme/app": summary({
            services: ["github"],
            isMonorepo: true,
            envKeys: 0,
          }),
        }}
        busy={null}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText("monorepo")).toBeTruthy();
  });

  it("says nothing about a summary written before the scan detected this", () => {
    // Cached summaries outlive a deploy: `isMonorepo` arrives absent, and
    // absent must not render as "not a monorepo" any louder than it renders
    // as one.
    render(
      <RepoGrid
        repos={[repo("app")]}
        summaries={{ "acme/app": summary() }}
        busy={null}
        onPick={vi.fn()}
      />,
    );

    expect(screen.queryByText("monorepo")).toBeNull();
  });

  it("dims a repo with no app and refuses the click", () => {
    const onPick = vi.fn();
    render(
      <RepoGrid
        repos={[repo("docs")]}
        summaries={{
          "acme/docs": summary({
            full_name: "acme/docs",
            hasApp: false,
            envKeys: 0,
            services: ["github"],
          }),
        }}
        busy={null}
        onPick={onPick}
      />,
    );

    expect(screen.getByText("no app detected")).toBeTruthy();
    fireEvent.click(screen.getByText("acme/docs"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("leaves an unscanned repo plain and clickable", () => {
    // The state a repo past the frontend's scan cap is in, and the state every
    // repo is in for the first moment after load. It must not read as broken.
    const onPick = vi.fn();
    render(
      <RepoGrid
        repos={[repo("api")]}
        summaries={{}}
        busy={null}
        onPick={onPick}
      />,
    );

    expect(screen.queryByText("no app detected")).toBeNull();
    fireEvent.click(screen.getByText("acme/api"));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("shows the analysing cell and blocks the others", () => {
    const onPick = vi.fn();
    render(
      <RepoGrid
        repos={[repo("app"), repo("api")]}
        summaries={{}}
        busy="https://github.com/acme/app"
        onPick={onPick}
      />,
    );

    expect(screen.getByText("analyzing…")).toBeTruthy();
    fireEvent.click(screen.getByText("acme/api"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
