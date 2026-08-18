import type { ReactNode } from "react";
import { StateDot, type Tone } from "../../console/StateTag";

/**
 * The one visual form every canvas node takes.
 *
 * Replaces ActionNode's gradient stripe, two glow layers, per-provider
 * border tint and 0 8px 32px shadow, and the coloured header bands on
 * TriggerNode and LogicNode. A node is a panel that has risen off the ground
 * by exactly as much as every other panel in the console — `--raise`, which
 * is an inset highlight on dark and a drop shadow on light. Selection is a
 * brighter border, not a coloured ring.
 *
 * The shell deliberately renders **no handles**. Every node type pins its own
 * handle ids — `source-right` / `target-left` on ActionNode (which
 * edgeDisplay's normalizeHandles writes into every saved edge), `trig-s-*` on
 * TriggerNode, `yes` / `no` on LogicNode — so a generic port would have to be
 * a fifth, unused one. The files keep their own `<Handle>` elements and share
 * only `PORT_CLASS`.
 */

/** The one handle look. Apply to an existing `<Handle>`; never change its id. */
export const PORT_CLASS =
  "!h-[7px] !w-[7px] !rounded-full !border !border-border !bg-background transition-colors hover:!border-foreground/50";

const footToneClass: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  crit: "text-crit",
  idle: "text-muted-foreground",
};

export function NodeShell({
  selected,
  icon,
  label,
  provider,
  footTone,
  footLabel,
  footMeta,
  width = 240,
  action,
  children,
}: {
  selected?: boolean;
  icon: ReactNode;
  label: string;
  provider: string;
  footTone?: Tone;
  footLabel?: string;
  footMeta?: string;
  width?: number;
  /** Top-right slot — the node's overflow menu button. */
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      style={{ width }}
      // bg-popover, not bg-card: a node floats over the canvas, and both
      // --card (2% white) and --secondary are translucent in dark, so every
      // edge routed behind a node ghosted straight through it. --popover is
      // opaque in both themes and still sits one step above the ground.
      // Selection is therefore the border alone, which is what the spec asks
      // for anyway — a fill change would have to be opaque too.
      className={`rounded-xl border bg-popover p-3.5 shadow-[var(--raise)] transition-colors ${
        selected ? "border-[var(--sel)]" : "border-border-soft"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg border border-border text-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium tracking-[-0.01em]">
            {label}
          </div>
          <div className="mt-px truncate font-mono text-[10.5px] lowercase text-muted-foreground">
            {provider}
          </div>
        </div>
        {action}
      </div>

      {children}

      {footLabel && (
        <div className="mt-3 flex items-center gap-2 border-t border-border-soft pt-2.5 font-mono text-[10px] lowercase text-dim">
          {footTone ? (
            <span
              className={`flex items-center gap-1.5 ${footToneClass[footTone]}`}
            >
              <StateDot tone={footTone} />
              {footLabel}
            </span>
          ) : (
            <span>{footLabel}</span>
          )}
          {footMeta && <span>· {footMeta}</span>}
        </div>
      )}
    </div>
  );
}
