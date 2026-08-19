import { GitBranch, Plus, Zap } from "lucide-react";
import type { CanvasUpdatePayload } from "../../lib/api";

/**
 * What the assistant proposes to put on the canvas, and whether it got there.
 *
 * Three states, because there are three situations and the card used to
 * collapse two of them:
 *
 *  - `applied`  — the canvas took it. The card is a receipt, not a button.
 *  - `canApply` — it did not, but this view owns a canvas, so the button works.
 *    Reached by resuming on the workspace a conversation whose updates were
 *    produced somewhere that had no canvas: the message is stored with
 *    `autoApplied: false` and the button is the only way to apply it.
 *  - neither    — nothing here can apply it, so nothing here offers to. The
 *    mobile sheet renders ChatPanel without `onAddNodes`; before this state
 *    existed it drew the enabled button anyway and `handleApply` returned on
 *    its first line, so the click did nothing, said nothing, and could be
 *    repeated forever.
 */
export function CanvasUpdateCard({
  update,
  onApply,
  applied,
  canApply,
}: {
  update: CanvasUpdatePayload;
  onApply: () => void;
  applied: boolean;
  canApply: boolean;
}) {
  return (
    <div className="mt-1.5 rounded-xl border border-border bg-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-soft">
        <GitBranch size={11} className="text-primary/60 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">
          {update.description ??
            `${update.nodes.length} node${update.nodes.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Nodes preview */}
      <div className="px-3 py-2 flex flex-col gap-1">
        {update.nodes.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            {/* D3: node type is carried by the word, not by a hue. The five
                colours this used to switch on — green trigger, blue agent,
                purple action, amber logic, orange approval — are the exact
                set the spec deletes, and `blue` was already neutralised by
                the --app-blue bridge, so the map had been showing four
                colours where it promised five ever since. */}
            <span className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded border text-muted-foreground bg-secondary border-border-soft">
              {n.type}
            </span>
            <span className="text-[13px] text-muted-foreground truncate">
              {String(n.data?.label ?? n.type)}
            </span>
          </div>
        ))}
        {update.edges.length > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5 pt-1.5 border-t border-border-soft">
            <Zap size={9} className="text-dim flex-shrink-0" />
            <span className="text-[11px] text-dim font-mono">
              {update.edges.length} connection
              {update.edges.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>

      {/* Outcome */}
      <div className="px-3 pb-3">
        {applied ? (
          <span className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-ok/20 bg-ok/10 py-1.5 text-[13px] font-semibold text-ok">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Added to canvas
          </span>
        ) : canApply ? (
          <button
            onClick={onApply}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[13px] font-semibold transition-all bg-primary/15 border border-primary/25 text-primary hover:bg-primary/25 hover:border-primary/40 active:scale-[0.98]"
          >
            <Plus size={11} />
            Add to canvas
          </button>
        ) : (
          <span className="block text-[12px] text-dim">
            Not added — this view has no canvas.
          </span>
        )}
      </div>
    </div>
  );
}
