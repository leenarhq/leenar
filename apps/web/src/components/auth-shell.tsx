import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { LogoMark } from "./console/LogoMark";

/**
 * The mark lives in components/console/ now; this re-export keeps the eight
 * files that import `LeenarMark` from here working unchanged.
 */
export const LeenarMark = LogoMark;

/**
 * Shared shell for the auth pages (login / signup / reset).
 *
 * A 376px column on the plain ground. What used to be here: a radial-gradient
 * glow (a gradient mesh blob, which the design system rules out), a shadow-xl card
 * with a gradient hairline across its top, and the last dashed border in the
 * app. A card floating in a void is the most templated auth layout there is,
 * and shadow-xl is not in the elevation system.
 */
export function AuthShell({
  children,
  backTo = "/",
  backLabel = "Back to home",
  title,
  subtitle,
  foot,
}: {
  children: ReactNode;
  backTo?: "/" | "/login";
  backLabel?: string;
  title: string;
  subtitle?: string;
  foot?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <nav className="px-6 py-5">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 font-mono text-[10px] lowercase text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
        </Link>
      </nav>

      <main
        id="content"
        tabIndex={-1}
        className="flex flex-1 items-center justify-center px-6 py-8"
      >
        <div className="w-full max-w-[376px]">
          <div className="flex items-center gap-2.5">
            <LeenarMark className="h-[15px] w-auto" />
            <span className="text-sm font-medium tracking-[-0.01em]">
              Leenar
            </span>
          </div>
          <h1 className="mt-5 font-display text-2xl font-light tracking-[-0.02em]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 text-[13.5px] text-muted-foreground">
              {subtitle}
            </p>
          )}
          <div className="mt-6">{children}</div>
        </div>
      </main>

      {foot && (
        <div className="px-6 pb-6 text-center font-mono text-[10px] lowercase text-dim">
          {foot}
        </div>
      )}
    </div>
  );
}

/** Shared field label + input styled to match the console form pattern. */
export function AuthField({
  id,
  label,
  labelRight,
  ...props
}: {
  id: string;
  label: string;
  labelRight?: ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label
          htmlFor={id}
          className="font-mono text-[10px] lowercase text-dim"
        >
          {label}
        </label>
        {labelRight}
      </div>
      <input
        id={id}
        className="w-full rounded-lg border border-border-soft bg-card px-3.5 py-2.5 text-[13.5px] shadow-[var(--raise)] placeholder:text-dim focus:border-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
        {...props}
      />
    </div>
  );
}

/** Primary submit button. */
export function AuthSubmit({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className="w-full rounded-full bg-primary px-4 py-2.5 text-[13.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

const STRENGTH_LABELS = ["weak", "fair", "strong"];

/**
 * A 3-segment password strength meter. `strength` is 0–3.
 *
 * No colour. It used to run destructive -> yellow -> emerald, but a weak
 * password is not an *error* — red says the wrong thing about a field the
 * user has not finished filling in. Colour marks state, and "not yet strong"
 * is progress. The strength is stated in a word instead.
 */
export function PasswordStrength({ strength }: { strength: number }) {
  return (
    <div className="mt-2">
      <div className="flex gap-1.5">
        {[1, 2, 3].map((seg) => (
          <div
            key={seg}
            className={`h-0.5 flex-1 rounded-full transition-colors ${
              strength >= seg ? "bg-foreground" : "bg-border"
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 font-mono text-[10px] lowercase text-dim">
        {strength > 0 ? STRENGTH_LABELS[strength - 1] : "enter a password"}
      </p>
    </div>
  );
}

export function GithubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
