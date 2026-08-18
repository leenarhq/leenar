import { INPUT, PILL_QUIET } from "./Field";

/**
 * The chat path, kept one click away without giving it the page.
 *
 * `data-tour="chat"` lives here because the onboarding "build" step
 * spotlights it (lib/onboardingState.ts). It used to sit on the tab-list
 * wrapper for the same reason — that wrapper was the one thing on screen
 * whichever tab was open. This strip is on screen unconditionally, so the
 * reasoning carries over intact.
 */
export function PromptStrip({
  value,
  onChange,
  onSubmit,
  disabled,
  emphasised = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  emphasised?: boolean;
}) {
  return (
    <div
      data-tour="chat"
      className={`mt-5 flex flex-col gap-3 rounded-2xl border border-border px-5 py-4 sm:flex-row sm:items-center ${
        emphasised ? "bg-secondary" : ""
      }`}
    >
      <span className="shrink-0 font-mono text-[11px] lowercase text-dim">
        nothing to import?
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSubmit();
        }}
        disabled={disabled}
        placeholder="Describe what you want to build…"
        className={`${INPUT} flex-1 disabled:opacity-50`}
      />
      <button
        onClick={onSubmit}
        disabled={disabled || !value.trim()}
        className={PILL_QUIET}
      >
        {disabled ? "Thinking…" : "Build it"}
      </button>
    </div>
  );
}
