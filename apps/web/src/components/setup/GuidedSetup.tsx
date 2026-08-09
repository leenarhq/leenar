import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { useOnboarding } from "../../context/onboarding";
import { useIsMobile } from "../../hooks/use-mobile";
import { SetupSpotlight } from "./SetupSpotlight";

function ProgressRing({ progress, size }: { progress: number; size: number }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28">
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        className="stroke-border"
        strokeWidth="2.5"
      />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeDasharray={`${c * progress} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 14 14)"
        style={{ transition: "stroke-dasharray 0.45s ease" }}
      />
    </svg>
  );
}

export function GuidedSetup() {
  const { ready, dismissed, collapsed, setup, actions } = useOnboarding();
  const isMobile = useIsMobile();

  // Auto-retire shortly after everything is done.
  useEffect(() => {
    if (!setup.allDone || dismissed) return;
    const t = setTimeout(() => actions.markOnboardingComplete(), 2500);
    return () => clearTimeout(t);
  }, [setup.allDone, dismissed, actions]);

  if (!ready || !setup.isFirstRun || dismissed) return null;

  const {
    steps,
    activeStepId,
    completedCount,
    totalSteps,
    progress,
    coreDone,
  } = setup;

  if (collapsed) {
    return createPortal(
      <button
        onClick={() => actions.collapse(false)}
        title="Show setup guide"
        className="fixed bottom-6 right-6 z-[9000] flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 shadow-lg transition-colors hover:border-primary/40"
      >
        <ProgressRing progress={progress} size={18} />
        <span className="text-[11.5px] font-semibold text-muted-foreground">
          {completedCount}/{totalSteps}
        </span>
      </button>,
      document.body,
    );
  }

  const panelBody = (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Get started</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {completedCount} of {totalSteps} complete
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProgressRing progress={progress} size={26} />
          <button
            onClick={() => actions.collapse(true)}
            title="Minimize"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        {steps.map((s) => {
          const isActive = s.id === activeStepId;
          return (
            <div
              key={s.id}
              className={`rounded-lg border p-3 transition-colors ${
                isActive
                  ? "border-primary/40 bg-primary/5"
                  : "border-transparent"
              }`}
              style={{ opacity: s.done ? 0.6 : 1 }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border ${
                    s.done
                      ? "border-emerald-500/40 bg-emerald-500/15"
                      : "border-border bg-muted"
                  }`}
                >
                  {s.done && (
                    <Check
                      className="h-3 w-3 text-emerald-400"
                      strokeWidth={3}
                    />
                  )}
                </span>
                <p
                  className={`text-xs font-medium ${
                    s.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {s.title}
                </p>
              </div>
              {isActive && (
                <div className="mt-2 pl-[28px]">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {s.oneLiner}
                  </p>
                  {s.cta.href && (
                    <a
                      href={s.cta.href}
                      className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      {s.cta.label} →
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {coreDone && (
        <div className="mt-auto border-t border-border p-3">
          <button
            onClick={actions.dismiss}
            className="text-[11px] text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            Dismiss guide
          </button>
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <>
        {createPortal(
          <aside className="fixed right-0 top-0 bottom-0 z-[9000] flex w-[300px] max-w-[85vw] flex-col overflow-y-auto border-l border-border bg-card shadow-xl">
            {panelBody}
          </aside>,
          document.body,
        )}
        <SetupSpotlight />
      </>
    );
  }

  return (
    <>
      <aside className="flex w-[300px] shrink-0 flex-col border-l border-border bg-card">
        {panelBody}
      </aside>
      <SetupSpotlight />
    </>
  );
}
