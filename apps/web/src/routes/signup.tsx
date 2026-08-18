import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/auth";
import { track } from "../lib/monitoring";
import { useCaptcha } from "../components/auth-captcha";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  PasswordStrength,
} from "../components/auth-shell";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
  head: () => ({
    meta: [
      { title: "Create your account — Leenar" },
      {
        name: "description",
        content:
          "Create a Leenar account and deploy your entire cloud stack with AI — no config, no YAML, no DevOps.",
      },
    ],
  }),
});

function strengthOf(password: string): number {
  if (password.length === 0) return 0;
  if (password.length < 8) return 1;
  if (password.length < 12) return 2;
  return 3;
}

function SignupPage() {
  const { session, loading: authLoading, isRecovery } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || !session) return;
    navigate({ to: isRecovery ? "/reset-password" : "/console" });
  }, [authLoading, session, isRecovery, navigate]);

  return <OpenSignup />;
}

/**
 * The signup form, on cloud and self-host alike.
 *
 * Whether an account is usable straight away is the backend's call, not this
 * form's: the compose stack sets GOTRUE_MAILER_AUTOCONFIRM=true and signUp()
 * comes back with a session, while cloud requires a confirmed email and comes
 * back without one. So the outcome is read from the response rather than
 * assumed — a session means the redirect effect in SignupPage takes over, and
 * no session means an email is on its way and saying so is the whole job.
 */
function OpenSignup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const captcha = useCaptcha();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name }, ...captcha.options },
      });
      if (signUpError) throw signUpError;
      track("user_signed_up", {
        method: data.session ? "password" : "password_confirm_email",
      });
      setNeedsConfirmation(!data.session);
      setDone(true);
      // With a session the auth listener redirects on its own; this is the
      // fallback for a slow emit. Never fires when a confirmation is pending —
      // /console would only bounce them back to /login.
      if (data.session) setTimeout(() => navigate({ to: "/console" }), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      // The token this attempt carried is spent either way.
      captcha.reset();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      backTo="/login"
      backLabel="Sign in instead"
      title="Create your account"
      subtitle="Describe a stack and Leenar wires it into your own cloud accounts."
      foot="no credit card · you keep every account"
    >
      {error && (
        <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {done ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-secondary/20 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-ok" />
          {needsConfirmation ? (
            <>
              <p className="text-sm font-medium">Confirm your email</p>
              <p className="text-xs text-muted-foreground">
                We sent a link to{" "}
                <span className="text-foreground">{email}</span>. Open it and
                you&apos;ll land straight in the console.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Account created!</p>
              <p className="text-xs text-muted-foreground">
                Redirecting to console…
              </p>
            </>
          )}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <AuthField
            id="name"
            label="Full name"
            type="text"
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
          <AuthField
            id="email"
            label="Email address"
            type="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <div>
            <AuthField
              id="password"
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
            <PasswordStrength strength={strengthOf(password)} />
          </div>
          {captcha.widget}
          <AuthSubmit type="submit" disabled={loading || !captcha.ready}>
            {loading ? "Creating account…" : "Create account →"}
          </AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
