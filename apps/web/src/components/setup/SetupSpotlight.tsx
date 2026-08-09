import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOnboarding } from "../../context/onboarding";

const PAD = 8;
const TOOLTIP_W = 300;
const GAP = 16;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function getRect(target: string): Rect | null {
  const el = document.querySelector(
    `[data-tour="${target}"]`,
  ) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return {
    top: r.top - PAD,
    left: r.left - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

export function SetupSpotlight() {
  const { ready, dismissed, collapsed, setup } = useOnboarding();
  const active = setup.steps.find((s) => s.id === setup.activeStepId) ?? null;
  const target = active?.target ?? "";
  const rafRef = useRef<number | null>(null);
  const lastRectRef = useRef<Rect | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!target) {
      lastRectRef.current = null;
      setRect(null);
      return;
    }
    const track = () => {
      const next = getRect(target);
      const prev = lastRectRef.current;
      const changed =
        (next === null) !== (prev === null) ||
        (next !== null &&
          prev !== null &&
          (next.top !== prev.top ||
            next.left !== prev.left ||
            next.width !== prev.width ||
            next.height !== prev.height));
      if (changed) {
        lastRectRef.current = next;
        setRect(next);
      }
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  if (!ready || !setup.isFirstRun || dismissed || collapsed) return null;
  if (!active || !target || !rect) return null;

  const tipLeft = Math.min(
    Math.max(12, rect.left),
    window.innerWidth - TOOLTIP_W - 12,
  );
  const tipTop = Math.min(
    rect.top + rect.height + GAP,
    window.innerHeight - 140,
  );

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9500,
        pointerEvents: "none",
      }}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0 }}
      >
        <defs>
          <mask id="setup-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={rect.left}
              y={rect.top}
              width={rect.width}
              height={rect.height}
              rx={10}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.35)"
          mask="url(#setup-spotlight-mask)"
        />
        <rect
          x={rect.left}
          y={rect.top}
          width={rect.width}
          height={rect.height}
          rx={10}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
        />
      </svg>
      <div
        className="rounded-xl border border-border bg-card p-3 shadow-xl"
        style={{
          position: "absolute",
          width: TOOLTIP_W,
          left: tipLeft,
          top: tipTop,
          pointerEvents: "auto",
        }}
      >
        <p className="text-xs font-semibold text-foreground">{active.title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          {active.oneLiner}
        </p>
      </div>
    </div>,
    document.body,
  );
}
