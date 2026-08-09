/** Deploy-time branch-capability resolution.
 *
 *  Whether a provider can branch NATIVELY (vs falling back to an isolated
 *  resource) is a live property of the user's account — a Vercel↔GitHub link
 *  can be added or revoked at any time. So we resolve it AT DEPLOY TIME, never
 *  freezing it at branch-create time (spec §6.3 — avoids a stale decision that
 *  no longer matches reality). This module does the I/O; `branchStrategy.ts`
 *  maps the resolved capability to a concrete mode + naming suffix.
 */
import {
  branchStrategy,
  type BranchDecision,
  type BranchProvider,
} from "./branchStrategy";
import { assertVercelGitHubLinked } from "./vercel";

/** Resolve the native/isolated decision for one node at deploy time.
 *
 *  - Vercel: probe the GitHub link (`assertVercelGitHubLinked`). Any failure —
 *    not linked, or the check itself errored — degrades to `isolated` so a
 *    deploy never hard-fails just because native branching is unavailable.
 *  - GitHub / Cloudflare: always native, no probe needed.
 *  - Supabase: always isolated (schema-clone), no probe needed. */
export async function resolveBranchDecision(
  provider: BranchProvider,
  branchKey: string,
  opts: { vercelToken?: string; vercelRepoName?: string } = {},
): Promise<BranchDecision> {
  if (provider === "vercel") {
    let vercelGitHubLinked = false;
    if (opts.vercelToken) {
      try {
        await assertVercelGitHubLinked(opts.vercelToken, opts.vercelRepoName);
        vercelGitHubLinked = true;
      } catch {
        vercelGitHubLinked = false;
      }
    }
    return branchStrategy(provider, branchKey, { vercelGitHubLinked });
  }
  return branchStrategy(provider, branchKey);
}
