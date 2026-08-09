import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

/** The Leenar brand mark, traced from leenarnewlogo.svg. Inherits color via currentColor. */
export function LeenarMark({
  className = "h-4 w-auto",
}: {
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="16 16 576 726"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(0,978) scale(0.1,-0.1)">
        <path d="M3015 9548 c-38 -17 -135 -60 -215 -95 -146 -66 -282 -126 -575 -255 -88 -39 -187 -83 -220 -98 -33 -15 -134 -60 -225 -100 -91 -40 -179 -84 -196 -96 -69 -53 -53 7 -385 -1364 -55 -228 -125 -516 -155 -640 -30 -124 -71 -295 -90 -380 -19 -85 -77 -328 -129 -540 -227 -922 -275 -1123 -275 -1141 0 -10 -33 -155 -74 -321 -41 -167 -115 -471 -165 -675 -98 -399 -114 -504 -101 -640 30 -297 170 -527 396 -651 533 -292 1501 -149 2115 313 86 64 80 64 193 25 519 -175 1352 -199 1985 -56 533 121 710 270 797 673 30 144 131 603 143 658 111 486 -13 843 -389 1119 -288 212 -816 293 -1238 191 -410 -100 -840 -367 -1146 -714 -117 -132 -294 -362 -443 -574 -69 -97 -128 -179 -132 -181 -20 -13 -551 246 -551 269 0 1 16 63 34 136 19 74 58 249 86 389 28 140 57 280 65 310 8 30 55 235 105 455 50 220 102 448 116 508 29 120 -15 50 374 602 151 215 776 1114 888 1278 40 59 87 137 104 173 54 115 47 133 -262 759 -117 237 -241 490 -276 563 -35 74 -69 132 -76 131 -7 -1 -44 -15 -83 -31z m1406 -4958 c83 -96 184 -213 223 -260 39 -47 102 -121 140 -165 39 -44 76 -88 84 -97 14 -16 9 -20 -54 -49 -317 -142 -884 -254 -1202 -237 l-62 3 92 135 c237 345 607 852 618 848 4 -2 77 -82 161 -178z m-3243 -793 c156 -133 277 -218 563 -400 75 -48 143 -89 153 -93 27 -10 19 -22 -36 -54 -267 -153 -668 -176 -806 -47 -62 57 -101 199 -82 298 10 52 111 369 118 369 2 0 43 -33 90 -73z" />
      </g>
    </svg>
  );
}

/**
 * Shared shell for the auth pages (login / signup / reset).
 * Dark, dashed-border aesthetic consistent with the console + landing page.
 */
export function AuthShell({
  children,
  backTo = "/",
  backLabel = "Back to home",
  title,
  subtitle,
}: {
  children: ReactNode;
  backTo?: "/" | "/login";
  backLabel?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      {/* subtle radial glow backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px circle at 50% -10%, oklch(0.3 0.02 260 / 0.5), transparent 70%)",
        }}
      />
      <nav className="relative z-10 flex h-[57px] items-center border-b border-dashed border-border px-6">
        <Link
          to={backTo}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {backLabel}
        </Link>
      </nav>

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xl">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-foreground/30 to-transparent" />
            <div className="p-8">
              <div className="mb-6">
                <div className="mb-5 flex items-center gap-2">
                  <LeenarMark />
                  <span className="font-serif text-base">Leenar</span>
                </div>
                <h1 className="font-serif text-2xl">{title}</h1>
                {subtitle && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
              {children}
            </div>
          </div>
        </div>
      </main>
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
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor={id}
          className="text-xs font-medium text-muted-foreground"
        >
          {label}
        </label>
        {labelRight}
      </div>
      <input
        id={id}
        className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm placeholder:text-muted-foreground/60 focus:border-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
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
      className="w-full rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {children}
    </button>
  );
}

/** A 3-segment password strength meter. `strength` is 0–3. */
export function PasswordStrength({ strength }: { strength: number }) {
  const colors = ["bg-destructive", "bg-yellow-500", "bg-emerald-500"];
  return (
    <div className="mt-2 flex gap-1.5">
      {[1, 2, 3].map((seg) => (
        <div
          key={seg}
          className={`h-1 flex-1 rounded-full transition-colors ${
            strength >= seg ? colors[seg - 1] : "bg-secondary"
          }`}
        />
      ))}
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
