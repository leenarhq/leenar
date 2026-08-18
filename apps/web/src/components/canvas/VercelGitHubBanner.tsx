import { motion } from "framer-motion";

interface VercelGitHubBannerProps {
  vercelHasGitHub: boolean;
  githubHasVercel: boolean;
  onClose: () => void;
  onRetry: () => void;
}

export function VercelGitHubBanner({
  onClose,
  onRetry,
}: VercelGitHubBannerProps) {
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
        className="w-[420px] rounded-2xl border border-border bg-secondary p-6 flex flex-col gap-4 shadow-2xl"
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
            <h3 className="text-[15px] font-semibold text-foreground leading-tight">
              Vercel &amp; GitHub not linked
            </h3>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              Vercel needs permission to access your GitHub repos. This is a
              one-time setup.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--hover)] border border-border-soft p-3 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-warn text-[13px] mt-0.5">1.</span>
            <div>
              <p className="text-[14px] font-medium text-foreground">
                Go to Vercel → Settings → Git
              </p>
              <p className="text-[12px] text-dim mt-0.5">
                Connect your GitHub account inside Vercel
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-warn text-[13px] mt-0.5">2.</span>
            <div>
              <p className="text-[14px] font-medium text-foreground">
                Install Vercel App on GitHub
              </p>
              <p className="text-[12px] text-dim mt-0.5">
                Allow Vercel to access your repositories
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="py-2 px-3 rounded-lg border border-border text-[13px] font-semibold text-dim hover:bg-[var(--hover)] transition-all"
          >
            Cancel
          </button>
          <a
            href="https://vercel.com/account/settings/authentication"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg bg-secondary border border-border text-foreground text-[13px] font-semibold text-center hover:bg-secondary transition-all"
          >
            Connect on Vercel →
          </a>
          <a
            href="https://github.com/apps/vercel/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg bg-secondary border border-border text-foreground text-[13px] font-semibold text-center hover:bg-secondary transition-all"
          >
            Install on GitHub →
          </a>
          <button
            onClick={() => {
              onClose();
              setTimeout(onRetry, 100);
            }}
            className="flex-1 py-2 rounded-lg bg-secondary border border-border text-muted-foreground text-[13px] font-semibold hover:bg-secondary transition-all"
          >
            Done, retry →
          </button>
        </div>
      </div>
    </motion.div>
  );
}
