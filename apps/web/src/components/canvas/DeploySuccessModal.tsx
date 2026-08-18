import React, { useRef, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Session } from "@supabase/supabase-js";
import {
  Check,
  ExternalLink,
  X,
  LayoutDashboard,
  ScrollText,
  Share2,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { getVercelDeploymentState } from "../../lib/api";
import {
  mapReadyState,
  isPollDone,
  VERCEL_BUILD_POLL_MS,
  VERCEL_BUILD_MAX_ATTEMPTS,
  type BuildUi,
} from "../../lib/vercelBuildStatus";

export interface SuccessService {
  name: string;
  url: string;
  deploymentId?: string;
}

interface DeploySuccessModalProps {
  services: SuccessService[];
  stackId: string | null;
  workflowId: string;
  workflowName?: string;
  session: Session | null;
  onClose: () => void;
}

export function DeploySuccessModal({
  services,
  stackId,
  workflowId,
  workflowName,
  session,
  onClose,
}: DeploySuccessModalProps) {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Vercel build status per service (keyed by service name). Services without a
  // deploymentId are never polled and render as ready.
  const [buildUi, setBuildUi] = useState<Record<string, BuildUi>>({});

  useEffect(() => {
    if (!session) return;
    const pollable = services.filter((s) => s.deploymentId);
    if (pollable.length === 0) return;

    // Seed pollable services to "building" so their links start inactive.
    setBuildUi((prev) => {
      const next = { ...prev };
      for (const s of pollable) if (!next[s.name]) next[s.name] = "building";
      return next;
    });

    let cancelled = false;
    const timers: ReturnType<typeof setInterval>[] = [];

    for (const svc of pollable) {
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts += 1;
        try {
          const { readyState } = await getVercelDeploymentState(
            svc.deploymentId!,
            session,
          );
          if (cancelled) return;
          const ui = mapReadyState(readyState);
          if (isPollDone(ui)) {
            setBuildUi((p) => ({ ...p, [svc.name]: ui }));
            clearInterval(timer);
          } else if (attempts >= VERCEL_BUILD_MAX_ATTEMPTS) {
            // Give up waiting — activate the link anyway.
            setBuildUi((p) => ({ ...p, [svc.name]: "ready" }));
            clearInterval(timer);
          }
        } catch {
          // Transient endpoint/network error — ignore this tick, keep polling.
          if (cancelled) return;
          if (attempts >= VERCEL_BUILD_MAX_ATTEMPTS) {
            setBuildUi((p) => ({ ...p, [svc.name]: "ready" }));
            clearInterval(timer);
          }
        }
      }, VERCEL_BUILD_POLL_MS);
      timers.push(timer);
    }

    return () => {
      cancelled = true;
      for (const t of timers) clearInterval(t);
    };
  }, [services, session]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // A successful deploy is the one `ok` moment the console has, so the
    // confetti reads in the ok tone against the foreground — not the old
    // six-hue party, which was the loudest colour on any screen.
    const read = (v: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const colors = [
      read("--ok"),
      read("--foreground"),
      read("--muted-foreground"),
    ];
    const particles = Array.from({ length: 110 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * 120,
      vx: (Math.random() - 0.5) * 5,
      vy: 2.5 + Math.random() * 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      w: 5 + Math.random() * 8,
      h: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.18,
    }));

    const DURATION = 3200;
    const start = performance.now();
    let frame: number;

    const tick = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12;
        p.rot += p.rotV;
        const alpha = Math.max(0, 1 - Math.max(0, elapsed - 1800) / 1400);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (elapsed < DURATION) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const appUrl =
    services.find(
      (s) => s.url.includes("vercel.app") || s.url.includes("vercel.com"),
    )?.url ?? services[0]?.url;

  const isFirstDeploy =
    typeof localStorage !== "undefined" &&
    !localStorage.getItem("leenar_has_deployed");
  React.useEffect(() => {
    try {
      localStorage.setItem("leenar_has_deployed", "1");
    } catch {
      /* full */
    }
  }, []);

  const shareText = workflowName
    ? `Just deployed "${workflowName}" with @LeenarHQ in under 2 minutes! 🚀`
    : "Just deployed my stack with @LeenarHQ in under 2 minutes! 🚀";
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}${appUrl ? `&url=${encodeURIComponent(appUrl)}` : ""}`;

  const handleDashboard = () => {
    onClose();
    navigate({ to: "/console" });
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-[201]"
        style={{ width: "100vw", height: "100vh" }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex w-[400px] flex-col gap-5 rounded-2xl border border-border-soft bg-popover p-6 shadow-[var(--raise-lg)]"
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-ok/10 border border-ok/30 flex items-center justify-center flex-shrink-0">
                <Check size={17} className="text-ok" />
              </div>
              <div>
                <h3 className="text-[14px] font-semibold text-foreground leading-tight">
                  {isFirstDeploy ? "First deploy!" : "Stack deployed"}
                </h3>
                <p className="text-[11px] text-dim mt-0.5">
                  {isFirstDeploy
                    ? "Welcome to the club — you're live 🎉"
                    : "All services are live and running"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-dim hover:text-muted-foreground transition-colors rounded-md hover:bg-[var(--hover)]"
            >
              <X size={15} />
            </button>
          </div>

          {/* Service list */}
          {services.length > 0 && (
            <div className="rounded-xl bg-[var(--hover)] border border-border-soft divide-y divide-border-soft">
              {services.map((svc) => {
                const ui: BuildUi = svc.deploymentId
                  ? (buildUi[svc.name] ?? "building")
                  : "ready";
                const building = ui === "building";
                const errored = ui === "error";
                const Row = (
                  <>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${
                          building
                            ? "bg-warn animate-pulse"
                            : errored
                              ? "bg-crit"
                              : "bg-ok"
                        }`}
                      />
                      <span className="text-[12px] font-medium text-foreground">
                        {svc.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-dim group-hover:text-muted-foreground transition-colors">
                      {building ? (
                        <span className="flex items-center gap-1 text-[10px] text-warn">
                          <Loader2 size={10} className="animate-spin" />
                          building on Vercel… (~1-3 min)
                        </span>
                      ) : errored ? (
                        <span className="flex items-center gap-1 text-[10px] text-crit">
                          <AlertTriangle size={10} />
                          build failed
                        </span>
                      ) : (
                        <>
                          <span className="text-[10px] font-mono truncate max-w-[180px]">
                            {svc.url.replace(/^https?:\/\//, "")}
                          </span>
                          <ExternalLink size={10} className="flex-shrink-0" />
                        </>
                      )}
                    </div>
                  </>
                );
                const rowClass =
                  "flex items-center justify-between px-3.5 py-2.5 transition-colors group first:rounded-t-xl last:rounded-b-xl";
                return building || errored ? (
                  <div
                    key={svc.name}
                    className={`${rowClass} opacity-70 cursor-default`}
                    title={
                      building
                        ? "Vercel is still building this deployment."
                        : "Vercel reported a build failure — check the Vercel dashboard."
                    }
                  >
                    {Row}
                  </div>
                ) : (
                  <a
                    key={svc.name}
                    href={svc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${rowClass} hover:bg-[var(--hover)]`}
                  >
                    {Row}
                  </a>
                );
              })}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2.5">
            <button
              onClick={handleDashboard}
              className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:bg-[var(--hover)] hover:text-muted-foreground transition-all"
            >
              <LayoutDashboard size={12} />
              Dashboard
            </button>
            {stackId && (
              <button
                onClick={() => {
                  onClose();
                  navigate({
                    to: "/console/projects/$id/logs",
                    params: { id: workflowId },
                  });
                }}
                className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:bg-[var(--hover)] hover:text-muted-foreground transition-all"
              >
                <ScrollText size={12} />
                View Logs
              </button>
            )}
            <a
              href={tweetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg border border-border text-[11px] font-semibold text-muted-foreground hover:bg-[var(--hover)] hover:text-muted-foreground transition-all"
            >
              <Share2 size={11} />
              Share
            </a>
            {appUrl && (
              <a
                href={appUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg bg-ok/10 border border-ok/30 text-ok text-[11px] font-semibold hover:bg-ok/15 transition-all"
              >
                Open App
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
