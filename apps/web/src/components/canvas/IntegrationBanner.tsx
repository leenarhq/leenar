import { motion } from "framer-motion";
import { SERVICE_DISPLAY } from "./workspaceHelpers";

interface IntegrationBannerProps {
  banner: { type: "missing"; services: string[] };
  onClose: () => void;
  onConnect: (svc: string) => void;
}

export function IntegrationBanner({
  banner,
  onClose,
  onConnect,
}: IntegrationBannerProps) {
  const title = `Connect ${banner.services.map((s) => SERVICE_DISPLAY[s]?.label ?? s).join(" & ")} to deploy`;
  const subtitle = `${banner.services.length > 1 ? "These integrations are" : "This integration is"} required by your canvas but haven't been connected yet.`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      style={{
        background: "color-mix(in srgb, var(--background) 80%, transparent)",
        backdropFilter: "blur(6px)",
      }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] rounded-2xl border border-border bg-secondary p-6 flex flex-col gap-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-warn/10 border border-warn/20 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2L14.928 14H1.072L8 2Z"
                stroke="var(--warn)"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M8 6V9"
                stroke="var(--warn)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11.5" r="0.75" fill="var(--warn)" />
            </svg>
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-foreground leading-tight">
              {title}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--hover)] border border-border-soft p-3 space-y-2">
          {banner.services.map((svc) => {
            const info = SERVICE_DISPLAY[svc] ?? { label: svc };
            return (
              <div key={svc} className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-foreground">
                  {info.label}
                </span>
                <button
                  onClick={() => onConnect(svc)}
                  className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  Connect →
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-border text-[11px] font-semibold text-dim hover:bg-[var(--hover)] transition-all"
          >
            Cancel
          </button>
          <a
            href="/console/integrations"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg bg-secondary border border-border text-muted-foreground text-[11px] font-semibold text-center hover:bg-secondary transition-all"
          >
            Go to Integrations →
          </a>
        </div>
      </div>
    </motion.div>
  );
}
