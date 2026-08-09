import { motion } from "framer-motion";

interface AiDiagnosisCardProps {
  aiSuggestion: string | null;
  aiSuggestionLoading: boolean;
  deployErrorMsg: string | null;
  onConnectService: (svc: string) => void;
}

export function AiDiagnosisCard({
  aiSuggestion,
  aiSuggestionLoading,
  deployErrorMsg,
  onConnectService,
}: AiDiagnosisCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[440px] max-w-[calc(100vw-2rem)] rounded-xl border border-amber-500/20 bg-surface-container-low/95 backdrop-blur-md p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-amber-500/12 border border-amber-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(251,191,36,0.85)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-amber-400/90 mb-1">
            AI Diagnosis
          </p>
          {aiSuggestionLoading ? (
            <p className="text-[13px] text-white/35 animate-pulse">
              Analyzing error…
            </p>
          ) : (
            <p className="text-[13px] text-white/60 leading-relaxed">
              {aiSuggestion}
            </p>
          )}
          {!aiSuggestionLoading && deployErrorMsg && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {/* Vercel needs GitHub integration installed — reconnect buttons are not helpful here */}
              {/install.*github.*integration|github.*integration.*first/i.test(
                deployErrorMsg,
              ) ? (
                <a
                  href="https://github.com/settings/installations"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-md bg-amber-500/12 border border-amber-500/25 text-[12px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
                >
                  Configure Vercel App on GitHub →
                </a>
              ) : (
                [
                  { svc: "vercel", label: "Reconnect Vercel" },
                  { svc: "github", label: "Reconnect GitHub" },
                  { svc: "supabase", label: "Reconnect Supabase" },
                  { svc: "resend", label: "Reconnect Resend" },
                ]
                  .filter(({ svc }) =>
                    deployErrorMsg.toLowerCase().includes(svc.toLowerCase()),
                  )
                  .map(({ svc, label }) => (
                    <button
                      key={svc}
                      onClick={() => onConnectService(svc)}
                      className="px-2.5 py-1 rounded-md bg-amber-500/12 border border-amber-500/25 text-[12px] font-semibold text-amber-400 hover:bg-amber-500/20 transition-colors"
                    >
                      {label}
                    </button>
                  ))
              )}
              <a
                href="/console/integrations"
                className="px-2.5 py-1 rounded-md bg-white/[0.05] border border-white/[0.08] text-[12px] font-semibold text-white/40 hover:text-white/60 hover:bg-white/[0.08] transition-colors"
              >
                Integrations
              </a>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
