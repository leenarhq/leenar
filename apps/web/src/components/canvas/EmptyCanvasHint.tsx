interface EmptyCanvasHintProps {
  onPrefill: (text: string) => void;
  onImportExisting?: () => void;
}

export function EmptyCanvasHint({
  onPrefill,
  onImportExisting,
}: EmptyCanvasHintProps) {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
      <div className="pointer-events-auto flex w-full max-w-[440px] flex-col gap-3 px-4">
        <p className="mb-1 text-center text-[15px] font-semibold tracking-tight text-[var(--app-text-dim)]">
          What do you want to deploy?
        </p>

        {/* Door 1: describe */}
        <button
          onClick={() =>
            onPrefill("Next.js app with Supabase auth and Vercel hosting")
          }
          className="flex flex-col gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left transition-colors hover:border-[var(--app-text-faint)]"
        >
          <span className="text-sm font-semibold text-[var(--app-text-dim)]">
            Describe what you want to build
          </span>
          <span className="text-xs text-[var(--app-text-muted)]">
            Tell the AI chat your idea — it wires up the services and deploys.
          </span>
        </button>

        {/* Door 2: bring existing */}
        {onImportExisting && (
          <button
            onClick={onImportExisting}
            className="flex flex-col gap-1 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 text-left transition-colors hover:border-[var(--app-text-faint)]"
          >
            <span className="text-sm font-semibold text-[var(--app-text-dim)]">
              Bring an existing project
            </span>
            <span className="text-xs text-[var(--app-text-muted)]">
              Connect a GitHub repo and deploy it.
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
