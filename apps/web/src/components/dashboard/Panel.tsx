import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/**
 * The dashboard's card. One hairline container, a mono header that reads
 * like a RowHead, and a body. The header is lowercase because a panel
 * title labels machine surface — the same reason the console's counts and
 * ids are mono. Titles are passed in sentence case and the CSS lowers
 * them, so no caller has to know.
 */
export function Panel({
  title,
  icon: Icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[var(--raise)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-2.5">
        <div className="flex items-center gap-2 font-mono text-[10px] lowercase tracking-wide text-dim">
          {Icon && <Icon className="h-3 w-3" />}
          {title}
        </div>
        {action}
      </div>
      <div className={cn("flex-1 p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="py-8 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}
