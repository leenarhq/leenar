import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/auth";
import { track } from "../lib/monitoring";
import { authSurface } from "../lib/authSurface";
import { resolveLoginEmail, LOGIN_ACCEPTS_USERNAME } from "../lib/ycAlias";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  GithubIcon,
  GoogleIcon,
} from "../components/auth-shell";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Sign in — Leenar" },
      {
        name: "description",
        content:
          "Sign in to Leenar to deploy and manage your cloud stack — GitHub, Vercel, Supabase, and Resend, wired together automatically.",
      },
    ],
  }),
});

const CALLBACK_URL = `${typeof window !== "undefined" ? window.location.origin : ""}/auth/callback`;

type View = "signin" | "forgot" | "magic";

// Supabase (AuthApiError) returns status 400 with code "otp_disabled" and
// message "Signups not allowed for otp" when signInWithOtp targets an email
// that isn't registered (with shouldCreateUser: false). We swallow only
// this class of error to avoid leaking account existence — everything
// else (rate limiting, network errors, malformed-email validation_failed/422)
// is surfaced normally.
function isUnknownUserAuthError(err: any): boolean {
  if (err?.code === "otp_disabled") return true;
  // Defensive fallback in case `code` is ever absent.
  const status = err?.status;
  const message = String(err?.message ?? "").toLowerCase();
  return status === 400 && message.includes("signups not allowed");
}

function LoginPage() {
  const { session, loading: authLoading, isRecovery } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>("signin");

  useEffect(() => {
    if (authLoading || !session) return;
    navigate({ to: isRecovery ? "/reset-password" : "/console" });
  }, [authLoading, session, isRecovery, navigate]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotSent, setForgotSent] = useState(false);
  const [magicSent, setMagicSent] = useState(false);
  const [failCount, setFailCount] = useState(0);
  const [lockUntil, setLockUntil] = useState<number | null>(null);
  const [lockSecsLeft, setLockSecsLeft] = useState(0);

  useEffect(() => {
    if (!lockUntil) return;
    const tick = () => {
      const left = Math.ceil((lockUntil - Date.now()) / 1000);
      if (left <= 0) {
        setLockUntil(null);
        setLockSecsLeft(0);
      } else setLockSecsLeft(left);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [lockUntil]);

  const isLocked = !!lockUntil && Date.now() < lockUntil;

  const switchView = (v: View) => {
    setView(v);
    setError(null);
    setForgotSent(false);
    setMagicSent(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    setLoading(true);

    try {
      if (view === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email: resolveLoginEmail(email),
          password,
        });
        if (error) throw error;
        track("user_signed_in", { method: "email" });
        navigate({ to: "/console" });
      }
      if (view === "forgot") {
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        setForgotSent(true);
      }
      if (view === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: CALLBACK_URL,
            shouldCreateUser: false,
          },
        });
        if (error) throw error;
        setMagicSent(true);
      }
    } catch (err: any) {
      // Never reveal whether an email is registered: when signups are
      // disabled, Supabase errors on unknown emails. Treat that class of
      // error as a fake success so the UI response is identical either way.
      if (view === "magic" && isUnknownUserAuthError(err)) {
        setMagicSent(true);
        setLoading(false);
        return;
      }
      const next = failCount + 1;
      setFailCount(next);
      if (next >= 5) {
        setLockUntil(Date.now() + 60_000);
        setFailCount(0);
        setError(null);
      } else {
        setError(err.message ?? "Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: "github" | "google") => {
    setError(null);
    track("user_signed_in", { method: provider });
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  };

  const titles: Record<View, string> = {
    signin: "Welcome back",
    forgot: "Reset password",
    magic: "Magic link",
  };
  const subtitles: Record<View, string> = {
    signin: "Sign in to access your workspace.",
    forgot: "Enter your email and we'll send you a reset link.",
    magic: "We'll email you a one-click sign-in link.",
  };

  const sent =
    (view === "magic" && magicSent) || (view === "forgot" && forgotSent);

  return (
    <AuthShell title={titles[view]} subtitle={subtitles[view]}>
      <div key={view}>
        {view === "signin" && authSurface.oauth && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleOAuth("github")}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary"
              >
                <GithubIcon /> GitHub
              </button>
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary"
              >
                <GoogleIcon /> Google
              </button>
            </div>
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                or continue with email
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        {isLocked && (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Too many failed attempts. Try again in {lockSecsLeft}s.
          </p>
        )}
        {!isLocked && error && (
          <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {sent ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-secondary/20 px-4 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            <p className="text-sm font-medium">Check your inbox</p>
            <p className="text-xs text-muted-foreground">
              {view === "magic" ? (
                <>
                  We sent a magic link to{" "}
                  <strong className="text-foreground">{email}</strong>
                </>
              ) : (
                <>
                  If an account exists for{" "}
                  <strong className="text-foreground">{email}</strong>, a reset
                  link has been sent.
                </>
              )}
            </p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleSubmit}>
            <AuthField
              id="email"
              label="Email address"
              // signin may accept a non-email username alias (see lib/ycAlias);
              // relax native validation only here — forgot/magic still require
              // a real email.
              type={
                view === "signin" && LOGIN_ACCEPTS_USERNAME ? "text" : "email"
              }
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            {view === "signin" && (
              <AuthField
                id="password"
                label="Password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                labelRight={
                  authSurface.passwordReset ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => switchView("forgot")}
                    >
                      Forgot password?
                    </button>
                  ) : undefined
                }
              />
            )}
            <AuthSubmit type="submit" disabled={loading || isLocked}>
              {isLocked
                ? `Locked (${lockSecsLeft}s)`
                : loading
                  ? "Please wait…"
                  : view === "signin"
                    ? "Sign in"
                    : view === "magic"
                      ? "Send magic link"
                      : "Send reset link"}
            </AuthSubmit>
          </form>
        )}

        <div className="mt-5 space-y-2 text-center text-sm">
          {view === "signin" && authSurface.magicLink && (
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={() => switchView("magic")}
            >
              Sign in with magic link instead
            </button>
          )}
          {view === "signin" && !authSurface.inviteRequired && (
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link to="/signup" className="text-foreground hover:underline">
                Create one
              </Link>
            </p>
          )}
          {(view === "forgot" || view === "magic") && (
            <button
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => switchView("signin")}
            >
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
