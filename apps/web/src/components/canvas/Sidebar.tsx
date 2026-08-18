/**
 * What is left of the old canvas sidebar.
 *
 * The `Sidebar` component itself was dead — nothing rendered it, and the
 * add-service palette it contained now lives in the Toolbar dock. Only these
 * three helpers survive, and ServiceDrawer plus the four drawer tabs import
 * them. The file keeps its name so those imports stay put.
 */
import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import * as LucideIcons from "lucide-react";

const CloudflareSvg = ({
  size,
  className,
  style,
}: {
  size: number;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 120"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    {/* Monochrome, and only the two silhouette paths. The mark's third path
        was filled #FFFFFF, which vanished on the light theme; the brand
        oranges are a provider hue and go with the rest of them (spec D3). */}
    <path
      d="M176.332,110.348 C177.925,105.037 177.394,99.726 174.739,96.539 C172.083,93.352 168.365,91.228 163.585,90.697 L71.17,89.634 C70.639,89.634 70.108,89.103 69.577,89.103 C69.046,88.572 69.046,88.041 69.577,87.51 C70.108,86.448 70.639,85.916 71.701,85.916 L164.647,84.854 C175.801,84.323 187.486,75.294 191.734,64.672 L197.046,50.863 C197.046,50.331 197.577,49.8 197.046,49.269 C191.203,22.182 166.772,1.999 138.091,1.999 C111.535,1.999 88.697,18.995 80.73,42.896 C75.419,39.178 69.046,37.053 61.61,37.585 C48.863,38.647 38.772,49.269 37.178,62.016 C36.647,65.203 37.178,68.39 37.71,71.576 C16.996,72.107 0,89.103 0,110.348 C0,112.472 0,114.066 0.531,116.19 C0.531,117.253 1.593,117.784 2.125,117.784 L172.614,117.784 C173.676,117.784 174.739,117.253 174.739,116.19 L176.332,110.348 Z"
      fill="currentColor"
    />
    <path
      d="M205.544,50.863 L202.888,50.863 C202.357,50.863 201.826,51.394 201.295,51.925 L197.577,64.672 C195.984,69.983 196.515,75.295 199.171,78.481 C201.826,81.668 205.544,83.792 210.324,84.323 L229.976,85.386 C230.507,85.386 231.038,85.917 231.569,85.917 C232.1,86.448 232.1,86.979 231.569,87.51 C231.038,88.573 230.507,89.104 229.444,89.104 L209.262,90.166 C198.108,90.697 186.424,99.726 182.175,110.348 L181.112,115.129 C180.581,115.66 181.112,116.722 182.175,116.722 L252.283,116.722 C253.345,116.722 253.876,116.191 253.876,115.129 C254.938,110.88 256,106.1 256,101.319 C256,73.701 233.162,50.863 205.544,50.863"
      fill="currentColor"
      opacity="0.55"
    />
  </svg>
);

export const IconRenderer = ({
  iconName,
  className,
  size = 13,
  style,
}: {
  iconName: string;
  className?: string;
  size?: number;
  style?: React.CSSProperties;
}) => {
  if (iconName === "Cloudflare")
    return <CloudflareSvg size={size} className={className} style={style} />;
  const Icon = (LucideIcons as any)[iconName] || LucideIcons.Box;
  return <Icon className={className} size={size} style={style} />;
};

// ── Helpers ────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const [showTip, setShowTip] = useState(false);
  const [tipPos, setTipPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const openTip = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setTipPos({ top: r.top, left: r.left });
    }
    setShowTip(true);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1">
        <label className="font-mono text-[10px] lowercase text-dim">
          {label}
        </label>
        {hint && (
          <div className="flex-shrink-0">
            <button
              ref={btnRef}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-dim transition-colors hover:bg-[var(--hover)] hover:text-foreground"
              onMouseEnter={openTip}
              onMouseLeave={() => setShowTip(false)}
              onFocus={openTip}
              onBlur={() => setShowTip(false)}
              tabIndex={-1}
            >
              <span className="text-[8px] leading-none">?</span>
            </button>
            {showTip &&
              createPortal(
                <div
                  className="pointer-events-none fixed z-[9999] w-[210px] rounded-xl border border-border-soft bg-popover px-2.5 py-2 shadow-[var(--raise-lg)]"
                  style={{
                    top: tipPos.top,
                    left: tipPos.left,
                    transform: "translateY(calc(-100% - 6px))",
                  }}
                >
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {hint}
                  </p>
                </div>,
                document.body,
              )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function inputCls(disabled: boolean) {
  return `w-full rounded-lg border border-border bg-secondary px-3 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-dim focus:border-foreground/30 ${
    disabled ? "cursor-not-allowed opacity-50" : ""
  }`;
}
