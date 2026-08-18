import { PILL } from "./Field";

/**
 * Because the page IS the repo list, it has no content at all
 * until GitHub is connected — which is the state every first-time user is in
 * by definition. The empty states are the screen, not an afterthought, so
 * they get the same bordered box the grid would have occupied rather than a
 * line of grey text floating where a grid used to be.
 */
export function EmptyCell({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void; busy?: boolean };
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border px-6 py-24 text-center">
      <p className="text-[14.5px]">{title}</p>
      <p className="mt-1.5 max-w-[420px] font-mono text-[11px] lowercase leading-relaxed text-dim">
        {body}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          disabled={action.busy}
          className={`mt-5 ${PILL}`}
        >
          {action.busy ? "Opening GitHub…" : action.label}
        </button>
      )}
    </div>
  );
}
