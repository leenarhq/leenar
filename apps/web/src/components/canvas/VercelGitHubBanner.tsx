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
      style={{ background: "rgba(5,5,5,0.80)", backdropFilter: "blur(6px)" }}
      className="fixed inset-0 z-[200] flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] rounded-2xl border border-white/[0.08] bg-surface-container-low p-6 flex flex-col gap-4 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 2L14.928 14H1.072L8 2Z"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path
                d="M8 6V9"
                stroke="#f59e0b"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11.5" r="0.75" fill="#f59e0b" />
            </svg>
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white/90 leading-tight">
              Vercel &amp; GitHub not linked
            </h3>
            <p className="text-[13px] text-white/40 mt-1 leading-relaxed">
              Vercel needs permission to access your GitHub repos. This is a
              one-time setup.
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-3">
          <div className="flex items-start gap-2">
            <span className="text-amber-400 text-[13px] mt-0.5">1.</span>
            <div>
              <p className="text-[14px] font-medium text-white/70">
                Go to Vercel → Settings → Git
              </p>
              <p className="text-[12px] text-white/35 mt-0.5">
                Connect your GitHub account inside Vercel
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-amber-400 text-[13px] mt-0.5">2.</span>
            <div>
              <p className="text-[14px] font-medium text-white/70">
                Install Vercel App on GitHub
              </p>
              <p className="text-[12px] text-white/35 mt-0.5">
                Allow Vercel to access your repositories
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="py-2 px-3 rounded-lg border border-white/[0.07] text-[13px] font-semibold text-white/30 hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <a
            href="https://vercel.com/account/settings/authentication"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg bg-white/8 border border-white/15 text-white/70 text-[13px] font-semibold text-center hover:bg-white/12 transition-all"
          >
            Connect on Vercel →
          </a>
          <a
            href="https://github.com/apps/vercel/installations/new"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 rounded-lg bg-white/8 border border-white/15 text-white/70 text-[13px] font-semibold text-center hover:bg-white/12 transition-all"
          >
            Install on GitHub →
          </a>
          <button
            onClick={() => {
              onClose();
              setTimeout(onRetry, 100);
            }}
            className="flex-1 py-2 rounded-lg bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[13px] font-semibold hover:bg-blue-500/20 transition-all"
          >
            Done, retry →
          </button>
        </div>
      </div>
    </motion.div>
  );
}
