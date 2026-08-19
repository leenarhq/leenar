import type { ReactNode, HTMLAttributes } from "react";

/** A hairline-separated list. Replaces the hand-rolled tables in
 *  deployments, activity, api-tokens and the database column detail. */
export function Rows({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {children}
    </div>
  );
}

export function Row({
  className = "",
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center gap-3.5 border-b border-border-soft px-4 py-3 text-[13px] last:border-b-0 hover:bg-secondary ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The column labels.
 *
 * `className` exists for one purpose: a table whose columns stack on a phone
 * passes `hidden sm:flex`, because a header row describing columns that are no
 * longer beside each other is worse than no header at all. See the `sm:contents`
 * pattern in settings/api-tokens for the body half of that.
 */
export function RowHead({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3.5 border-b border-border-soft bg-card px-4 py-2 font-mono text-[10px] lowercase tracking-wide text-dim ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * For a RowHead whose columns stack on a phone. Pair it with
 * `grid-cols-1 … sm:grid-cols-[…]` on the rows and `sm:contents` on whatever
 * groups the secondary cells into one wrapped line below the breakpoint.
 *
 * The header is hidden rather than stacked because a list of column names is
 * only meaningful while the columns are side by side; stacked, it reads as
 * four unexplained words above every row.
 */
export const ROW_HEAD_WIDE_ONLY = "hidden sm:flex";

/** Machine text: service names, ids, counts, keys. Always lowercase. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] lowercase tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

export function Dim({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[11px] lowercase tabular-nums text-dim">
      {children}
    </span>
  );
}
