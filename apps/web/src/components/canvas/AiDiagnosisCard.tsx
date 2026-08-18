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
      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 w-[440px] max-w-[calc(100vw-2rem)] rounded-xl border border-warn/20 bg-popover backdrop-blur-md p-4 shadow-2xl"
    >
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-lg bg-warn/10 border border-warn/30 flex items-center justify-center flex-shrink-0 mt-0.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--warn)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-warn mb-1">
            AI Diagnosis
          </p>
          {aiSuggestionLoading ? (
            <p className="text-[13px] text-dim animate-pulse">
              Analyzing error…
            </p>
          ) : (
            <p className="text-[13px] text-muted-foreground leading-relaxed">
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
                  className="px-2.5 py-1 rounded-md bg-warn/10 border border-warn/30 text-[12px] font-semibold text-warn hover:bg-warn/15 transition-colors"
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
                      className="px-2.5 py-1 rounded-md bg-warn/10 border border-warn/30 text-[12px] font-semibold text-warn hover:bg-warn/15 transition-colors"
                    >
                      {label}
                    </button>
                  ))
              )}
              <a
                href="/console/integrations"
                className="px-2.5 py-1 rounded-md bg-[var(--hover)] border border-border text-[12px] font-semibold text-muted-foreground hover:text-muted-foreground hover:bg-secondary transition-colors"
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
