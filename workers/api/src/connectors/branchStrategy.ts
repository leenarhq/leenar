/** Native-branching strategy resolution — PURE, no I/O.
 *
 *  A Leenar environment maps to a persistent, separately-addressable "branch"
 *  across four providers, keyed by `branchKey` (= the git branch name). Each
 *  provider is branched in one of two modes:
 *
 *  - `native`   — a lightweight branch sharing the parent's project/account
 *                 (GitHub git branch, Vercel preview branch, Cloudflare
 *                 namespaced Worker/bucket).
 *  - `isolated` — a fully separate resource (separate Vercel project, cloned
 *                 Supabase project). Used when native branching is impossible
 *                 (no GitHub↔Vercel link) or deliberately dropped (Supabase).
 *
 *  Capability (can we branch natively?) is resolved separately at deploy time
 *  in `capabilities.ts` — this module only maps (provider, capability) → mode.
 *  Keeping it pure makes the strategy matrix trivially testable and keeps the
 *  design decisions (spec §2) in one auditable place.
 */

export type BranchMode = "native" | "isolated";

/** Provider identity as used by backend dispatch (`node.data.provider`). */
export type BranchProvider = "github" | "vercel" | "supabase" | "cloudflare";

/** Whether native branching is possible for this node at deploy time. For
 *  providers that never branch natively (Supabase) or always do (GitHub,
 *  Cloudflare) this is ignored — see the matrix below. */
export interface BranchCapability {
  /** Vercel only: is the account/repo linked to GitHub so a preview branch
   *  can be created? Resolved via `assertVercelGitHubLinked`. */
  vercelGitHubLinked?: boolean;
}

export interface BranchDecision {
  mode: BranchMode;
  /** Suffix appended to native resource names (`<name>-<suffix>`). Empty for
   *  providers that don't rename in native mode (GitHub branch, Vercel preview
   *  branch share the parent project name). */
  namingSuffix: string;
}

/** Map (provider, capability) → branch mode. Locked decisions (spec §2):
 *  - GitHub    → ALWAYS native (git branch off the default branch).
 *  - Vercel    → native if git-linked, else isolated (separate project).
 *  - Supabase  → ALWAYS isolated (schema-clone). Native Supabase Branching is
 *                migration-file driven, but Leenar applies schema imperatively,
 *                so a native branch DB would be empty — deliberately dropped.
 *  - Cloudflare→ ALWAYS native (namespaced Worker + bucket `<name>-<key>`). */
export function branchStrategy(
  provider: BranchProvider,
  branchKey: string,
  capability: BranchCapability = {},
): BranchDecision {
  switch (provider) {
    case "github":
      return { mode: "native", namingSuffix: "" };
    case "vercel":
      return capability.vercelGitHubLinked
        ? { mode: "native", namingSuffix: "" }
        : { mode: "isolated", namingSuffix: `-${branchKey}` };
    case "supabase":
      return { mode: "isolated", namingSuffix: `-${branchKey}` };
    case "cloudflare":
      return { mode: "native", namingSuffix: `-${branchKey}` };
    default: {
      // Exhaustiveness guard — a new provider must declare its strategy.
      const _never: never = provider;
      throw new Error(`Unknown branch provider: ${_never}`);
    }
  }
}
