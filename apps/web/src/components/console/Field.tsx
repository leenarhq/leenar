import type { ReactNode } from "react";

/**
 * One settings form row: a fixed label column and the control on the right.
 * Eight pages used to lay this out eight ways. Below `sm` the column
 * collapses and the label sits above, because 140px of label on a phone
 * leaves nothing for the field — the one responsive concession this
 * primitive makes.
 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border-soft py-4 last:border-b-0 sm:flex-row sm:items-start sm:gap-6">
      <label className="w-[140px] shrink-0 pt-2 text-[13px] text-muted-foreground">
        {label}
      </label>
      <div className="min-w-0 flex-1">
        {children}
        {hint && (
          <p className="mt-1.5 text-[12px] text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** The hairline container the rows sit in. */
export function FieldGroup({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

/** The one input shape this surface uses. */
export const INPUT =
  "w-full rounded-lg border border-border bg-secondary px-3 py-2 text-[13px] text-foreground placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-ring";

/** The one save/submit shape. */
export const PILL =
  "inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50";

/** The quiet secondary shape. */
export const PILL_QUIET =
  "inline-flex shrink-0 items-center gap-2 rounded-full border border-border-soft px-3.5 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50";

/**
 * PILL with a glyph instead of a word: same fill, same radius, square.
 *
 * Not PILL with an icon child — `gap-2` and the asymmetric `px-3.5 py-2` are
 * there to sit a label off its edge, and with nothing to sit off they read as
 * a pill that lost its text. The point of sharing the shape is that the send
 * button and a Save button are recognisably the same control.
 */
export const PILL_ICON =
  "inline-flex shrink-0 items-center justify-center rounded-full bg-primary p-2 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40";
