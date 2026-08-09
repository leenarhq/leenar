import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Shared dashboard panel card — dashed-border console aesthetic. */
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
        "flex flex-col rounded-md border border-border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          {Icon && <Icon className="h-3.5 w-3.5" />}
          {title}
        </div>
        {action}
      </div>
      <div className={cn("flex-1 p-5", bodyClassName)}>{children}</div>
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <div className="py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

const toneClass: Record<string, string> = {
  success: "text-emerald-400",
  error: "text-destructive",
  warning: "text-yellow-500",
  neutral: "text-muted-foreground",
  up: "text-emerald-400",
  down: "text-destructive",
  unknown: "text-muted-foreground",
};

export function StatusDot({
  tone,
  className,
}: {
  tone: string;
  className?: string;
}) {
  const bg: Record<string, string> = {
    success: "bg-emerald-500",
    error: "bg-destructive",
    warning: "bg-yellow-500",
    neutral: "bg-muted-foreground",
    up: "bg-emerald-500",
    down: "bg-destructive",
    unknown: "bg-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        bg[tone] ?? "bg-muted-foreground",
        className,
      )}
    />
  );
}

export { toneClass };
