import type { ReactNode } from "react";

/**
 * Every console page opens the same way: one 56px bar, a plain page name,
 * optional machine-readable meta, actions on the right, one hairline under.
 *
 * Deliberately NOT the marketing two-tone headline. That pattern is a
 * persuasion device — claim then qualifier — and it earns its place on a
 * page you read once. A console is opened ten times a day, where a fixed
 * sentence is dead text from the second reading while still costing ~80px
 * above the content someone came for. See the spec's D4.
 */
export function PageBar({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-7 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em]">
        {title}
        {meta && (
          <span className="font-mono text-[10px] lowercase text-dim">
            {meta}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/** `project / section` for the routes nested under a project. */
export function Crumb({
  project,
  section,
}: {
  project: string;
  section: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="truncate text-muted-foreground">{project}</span>
      <span className="text-dim">/</span>
      <span className="truncate">{section}</span>
    </span>
  );
}
