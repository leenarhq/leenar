import { HairGrid, HairCell } from "./HairGrid";
import { envKeyLabel, repoMeta } from "../../lib/repos";
import type { GitHubRepo, RepoSummary } from "../../lib/api";

/**
 * The GitHub glyph, in the ink colour. Not the brand colour: a grid of forty
 * cells each carrying a brand hue is exactly what left ok/warn/crit with
 * nothing to say (spec D3). `currentColor` also means it survives the theme
 * toggle, which a hardcoded #fff does not — that defect has now been found
 * three times on this branch.
 */
function GitHubGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      width="15"
      height="15"
      aria-hidden
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * A service name, not a status.
 *
 * Deliberately not StateTag: that component is the console's only status
 * vocabulary, and "vercel" is not a status. It borrows the geometry of
 * StateTag's `idle` tone on purpose — a service name and a stateless tag
 * should not read as two different objects — and takes no hue, per D3.
 */
function SvcChip({
  label,
  strong = false,
}: {
  label: string;
  strong?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border-soft px-2 py-0.5 font-mono text-[10px] lowercase ${
        strong ? "text-foreground" : "text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}

/**
 * The repo list is the screen.
 *
 * A cell shows the name and push metadata from `GET /api/github/repos`, and
 * the env-key count, the detected stack and "is there an app here" from
 * `POST /api/github/repos/summary`. PR 5 left the last three out because the
 * only thing that could produce them was `analyzeRepo` — ~10 upstream
 * requests per repo behind a 20-per-5-minutes rate limit. PR 6 added a scan
 * that costs one GitHub API call per repo instead
 * (workers/api/src/repoScan.ts), which is what a forty-cell grid can pay.
 *
 * `summaries` is sparse by design. A repo missing from it is one the scan has
 * not reached yet, one past the caller's cap, or one GitHub would not answer
 * for — all three render as the plain, clickable, pre-PR-6 cell. Only a repo
 * whose summary explicitly says `hasApp: false` is dimmed and refused.
 */
export function RepoGrid({
  repos,
  summaries,
  busy,
  onPick,
}: {
  repos: GitHubRepo[];
  summaries: Record<string, RepoSummary>;
  busy: string | null;
  onPick: (repo: GitHubRepo) => void;
}) {
  return (
    <HairGrid cols={2}>
      {repos.map((r) => {
        const summary = summaries[r.full_name];
        const noApp = summary ? !summary.hasApp : false;
        const isBusy = busy === r.html_url;
        const blocked = (busy !== null && !isBusy) || noApp;
        // Every repo is on GitHub; a chip on all forty cells says nothing.
        const stack = summary?.services.filter((s) => s !== "github") ?? [];

        return (
          <HairCell
            key={r.id}
            hot={isBusy}
            onClick={() => !blocked && onPick(r)}
            // min-w-0: the cell is the grid item, and a grid item's automatic
            // minimum is its min-content size. The repo name is `truncate`,
            // which is `white-space: nowrap`, so one long name
            // ("a-very-long-repository-name-…") gives that cell a ~594px
            // floor — and because a track is shared, it widened the single
            // column at 390px for every cell while HairGrid's overflow-hidden
            // cropped the excess. Measured: 594px track inside a 332px box,
            // which ate `private` and, once PR 6 put it there, the env-key
            // count. A PR 5 defect that only became visible when something
            // was right-aligned.
            className={`group flex min-h-[104px] min-w-0 flex-col ${
              noApp
                ? // pointer-events, not just cursor: HairCell's hover fill is
                  // baked in, and a cell that lights up under the pointer is
                  // promising a click this one will not take.
                  "pointer-events-none opacity-50"
                : blocked
                  ? "cursor-default opacity-50"
                  : "cursor-pointer"
            }`}
          >
            <div className="flex items-start gap-3">
              <span className="mt-px flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border-soft text-muted-foreground transition-colors group-hover:text-foreground">
                <GitHubGlyph />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12.5px] text-foreground">
                  {r.full_name}
                </span>
                <span className="mt-1.5 block font-mono text-[10.5px] lowercase text-dim">
                  {repoMeta(r)}
                </span>
              </span>
              {r.private && (
                <span className="shrink-0 font-mono text-[10px] lowercase text-dim">
                  private
                </span>
              )}
            </div>

            <div className="mt-auto flex items-end gap-3 pt-3">
              {/* min-h holds one chip's height open before the scan lands.
                  Without it every cell grew 10px the moment the first batch
                  resolved, which on a full grid is the whole page stepping
                  downward under the pointer. It sits on this span rather than
                  the row because the row's min-height would have to absorb
                  pt-3 as well (border-box), and that number would then be two
                  measurements added together instead of one chip's height. */}
              <span className="flex min-h-[21px] min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {noApp ? (
                  // `strong` because the whole cell is at 50%: measured on
                  // this ladder that puts muted at 2.2:1 in dark and the dim
                  // meta line above it at 2.3:1. The cell is meant to recede,
                  // but this chip is the only thing saying WHY it cannot be
                  // clicked, so it is the one label that has to survive the
                  // fade. foreground × 50% lands where a normal chip sits.
                  <SvcChip label="no app detected" strong />
                ) : (
                  stack.map((s) => <SvcChip key={s} label={s} />)
                )}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] lowercase text-dim">
                {isBusy
                  ? "analyzing…"
                  : summary
                    ? envKeyLabel(summary.envKeys)
                    : ""}
              </span>
            </div>
          </HairCell>
        );
      })}
    </HairGrid>
  );
}
