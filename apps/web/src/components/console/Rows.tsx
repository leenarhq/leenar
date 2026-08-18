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

export function RowHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 border-b border-border-soft bg-card px-4 py-2 font-mono text-[10px] lowercase tracking-wide text-dim">
      {children}
    </div>
  );
}

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
