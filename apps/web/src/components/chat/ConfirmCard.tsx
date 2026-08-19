import type { CanvasUpdatePayload } from "../../lib/api";

/**
 * The gate in front of a destructive canvas change.
 *
 * Unlike CanvasUpdateCard this one never auto-applies: removing nodes and
 * disconnecting edges is the one thing the assistant is not allowed to do on
 * the user's behalf, so the card is the decision point rather than a receipt.
 * Once decided it collapses to a single line — there is nothing left to do
 * with it, and a spent card should not keep the weight of a live one.
 */
export function ConfirmCard({
  update,
  onApply,
  onCancel,
  applied,
  cancelled,
}: {
  update: CanvasUpdatePayload;
  onApply: () => void;
  onCancel: () => void;
  applied: boolean;
  cancelled: boolean;
}) {
  const isDone = applied || cancelled;
  if (isDone) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-secondary border border-border-soft">
        {/* `applied` here means a destructive change went through, which is a
            warn, not an ok. `cancelled` is not a state at all. */}
        <span
          className={`text-[12px] font-semibold ${applied ? "text-warn" : "text-dim"}`}
        >
          {applied ? "✓ Applied" : "✕ Cancelled"}
        </span>
        {update.description && (
          <span className="text-[12px] text-dim truncate">
            — {update.description}
          </span>
        )}
      </div>
    );
  }

  const removeCount = update.remove?.length ?? 0;
  const disconnCount = update.disconnect?.length ?? 0;

  return (
    <div className="mt-1.5 rounded-xl border border-warn/20 bg-warn/[0.04] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-warn/10">
        {/* currentColor, not #f59e0b: `npm run lint` cannot see an SVG stroke,
            and a literal amber here survives every theme flip. */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          className="text-warn"
        >
          <path
            d="M8 2L14.928 14H1.072L8 2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M8 6V9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
        </svg>
        <span className="text-[12px] font-semibold text-warn uppercase tracking-wider">
          Confirmation required
        </span>
      </div>
      <div className="px-3 py-2 flex flex-col gap-0.5">
        {update.description && (
          <p className="text-[13px] text-muted-foreground mb-1">
            {update.description}
          </p>
        )}
        {removeCount > 0 && (
          <p className="text-[12px] text-muted-foreground font-mono">
            Remove {removeCount} node{removeCount !== 1 ? "s" : ""} from canvas
          </p>
        )}
        {disconnCount > 0 && (
          <p className="text-[12px] text-muted-foreground font-mono">
            Disconnect {disconnCount} edge{disconnCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>
      <div className="px-3 pb-3 flex gap-2">
        <button
          onClick={onApply}
          // Solid, not a warn-tinted ghost. `text-warn` over `bg-warn/15`
          // measured 3.75:1 in the light theme — the fill lightens the ground
          // under ink that only clears 4.5:1 against the page. A solid tone
          // with background-coloured ink flips correctly in both themes, and
          // it is the shape the console already uses to confirm a destructive
          // action (DeleteProjectDialog's Button variant="destructive").
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold bg-warn text-background hover:opacity-90 active:scale-[0.98] transition-all"
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold border border-border text-muted-foreground hover:text-foreground hover:bg-secondary active:scale-[0.98] transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
