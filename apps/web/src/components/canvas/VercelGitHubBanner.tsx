import { motion } from "framer-motion";
import type { VercelGitHubReason } from "../../lib/api";

interface VercelGitHubBannerProps {
  reason: VercelGitHubReason;
  vercelHasGitHub: boolean;
  githubHasVercel: boolean;
  onClose: () => void;
  onRetry: () => void;
}

interface Step {
  title: string;
  detail: string;
}

interface Copy {
  title: string;
  body: string;
  steps: Step[];
  links: Array<{ label: string; href: string }>;
}

/**
 * Vercel answers "is GitHub linked?" in more than one way, and they don't share a
 * fix. A 403 (`auth_failed`) means the stored token can't reach the account's
 * scope — reconnecting Vercel fixes it and installing the GitHub App does not.
 * Showing the App instructions for every outcome sent people to a button that
 * could not help them, so each reason gets its own copy and its own links.
 */
function copyFor(reason: VercelGitHubReason): Copy {
  switch (reason) {
    case "auth_failed":
      return {
        title: "Vercel authorization expired",
        body: "Vercel rejected the request. Your stored authorization is no longer valid for this account, so Leenar can't read your repositories.",
        steps: [
          {
            title: "Reconnect Vercel in Leenar",
            detail: "Pick the same Vercel account or team you deploy to",
          },
        ],
        links: [{ label: "Reconnect Vercel →", href: "/console/integrations" }],
      };
    case "no_connection":
      return {
        title: "Vercel not connected",
        body: "This project deploys to Vercel, but no Vercel account is connected to Leenar yet.",
        steps: [
          {
            title: "Connect Vercel in Leenar",
            detail: "One-time authorization",
          },
        ],
        links: [{ label: "Connect Vercel →", href: "/console/integrations" }],
      };
    case "check_failed":
      return {
        title: "Couldn't check Vercel",
        body: "Leenar couldn't reach Vercel to verify your GitHub link, so the deploy was held back. This is usually temporary.",
        steps: [
          { title: "Try again in a moment", detail: "Nothing was changed" },
        ],
        links: [],
      };
    default:
      return {
        title: "Vercel & GitHub not linked",
        body: "Vercel needs permission to access your GitHub repos. This is a one-time setup.",
        steps: [
          {
            title: "Go to Vercel → Settings → Git",
            detail: "Connect your GitHub account inside Vercel",
          },
          {
            title: "Install Vercel App on GitHub",
            detail: "Allow Vercel to access your repositories",
          },
        ],
        links: [
          {
            label: "Connect on Vercel →",
            href: "https://vercel.com/account/settings/authentication",
          },
          {
            label: "Install on GitHub →",
            href: "https://github.com/apps/vercel/installations/new",
          },
        ],
      };
  }
}

export function VercelGitHubBanner({
  reason,
  onClose,
  onRetry,
}: VercelGitHubBannerProps) {
  const copy = copyFor(reason);
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
              {copy.title}
            </h3>
            <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
              {copy.body}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-[var(--hover)] border border-border-soft p-3 space-y-3">
          {copy.steps.map((step, i) => (
            <div key={step.title} className="flex items-start gap-2">
              <span className="text-warn text-[13px] mt-0.5">{i + 1}.</span>
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  {step.title}
                </p>
                <p className="text-[12px] text-dim mt-0.5">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="py-2 px-3 rounded-lg border border-border text-[13px] font-semibold text-dim hover:bg-[var(--hover)] transition-all"
          >
            Cancel
          </button>
          {copy.links.map((link) => {
            const external = link.href.startsWith("http");
            return (
              <a
                key={link.href}
                href={link.href}
                {...(external
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="flex-1 py-2 rounded-lg bg-secondary border border-border text-foreground text-[13px] font-semibold text-center hover:bg-secondary transition-all"
              >
                {link.label}
              </a>
            );
          })}
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
