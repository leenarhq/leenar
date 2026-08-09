import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/auth";
import { track } from "../lib/monitoring";
import { authSurface } from "../lib/authSurface";
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

const API_URL = (import.meta.env.VITE_API_URL as string) ?? "";

async function redeemInvite(
  token: string,
  email: string,
  password: string,
  name: string,
): Promise<{ ok: boolean; email?: string; error?: string }> {
  const res = await fetch(`${API_URL}/api/invite/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, email, password, name }),
  });
  return res.json();
}

function getTokenFromFragment(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get("token");
}

const reasonLabel: Record<string, string> = {
  not_found: "This invite link doesn't exist.",
  already_used: "This invite has already been used.",
  expired: "This invite link has expired.",
  no_token: "No invite token found in the link.",
  unknown: "This invite link is invalid.",
};

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

  return authSurface.inviteRequired ? <InviteSignup /> : <SelfHostSignup />;
}

function InviteSignup() {
  const navigate = useNavigate();

  const [token, setToken] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<
    "checking" | "valid" | "invalid"
  >("checking");
  const [invalidReason, setInvalidReason] = useState("");
  const [prefillEmail, setPrefillEmail] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = getTokenFromFragment();
    if (!t) {
      setToken(null);
      setTokenStatus("invalid");
      setInvalidReason("no_token");
      return;
    }
    setToken(t);
    fetch(`${API_URL}/api/invite/validate?token=${encodeURIComponent(t)}`)
      .then(
        (r) =>
          r.json() as Promise<{
            valid: boolean;
            email?: string;
            reason?: string;
          }>,
      )
      .then((res) => {
        if (res.valid) {
          setTokenStatus("valid");
          if (res.email) {
            setPrefillEmail(res.email);
            setEmail(res.email);
          }
        } else {
          setTokenStatus("invalid");
          setInvalidReason(res.reason ?? "unknown");
        }
      })
      .catch(() => {
        setTokenStatus("invalid");
        setInvalidReason("unknown");
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setLoading(true);
    try {
      const result = await redeemInvite(token, email, password, name);
      if (!result.ok || !result.email) {
        throw new Error(result.error ?? "Something went wrong.");
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.email,
        password,
      });
      if (signInError) throw signInError;
      track("user_signed_up", { method: "invite" });
      setDone(true);
      setTimeout(() => navigate({ to: "/console" }), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = strengthOf(password);

  if (tokenStatus === "checking") {
    return (
      <AuthShell
        backTo="/login"
        backLabel="Sign in instead"
        title="Validating invite…"
      >
        <p className="py-6 text-center text-sm text-muted-foreground">
          Validating your invite…
        </p>
      </AuthShell>
    );
  }

  if (tokenStatus === "invalid") {
    return (
      <AuthShell
        backTo="/login"
        backLabel="Sign in instead"
        title="Invalid invite"
        subtitle={reasonLabel[invalidReason] ?? reasonLabel.unknown}
      >
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      backTo="/login"
      backLabel="Sign in instead"
      title="You're invited"
      subtitle="Create your account to get started."
    >
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {done ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-secondary/20 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          <p className="text-sm font-medium">Account created!</p>
          <p className="text-xs text-muted-foreground">
            Redirecting to console…
          </p>
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
            readOnly={!!prefillEmail}
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
            <PasswordStrength strength={passwordStrength} />
          </div>
          <AuthSubmit type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create account →"}
          </AuthSubmit>
          <p className="text-center text-xs leading-relaxed text-muted-foreground">
            By creating an account, you agree to our{" "}
            <a
              href="/terms"
              className="text-foreground hover:underline"
              target="_blank"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="/privacy"
              className="text-foreground hover:underline"
              target="_blank"
            >
              Privacy Policy
            </a>
            .
          </p>
        </form>
      )}
    </AuthShell>
  );
}

/**
 * Open signup for the self-hosted core build. Cloud's invite gate is enforced
 * by the `check_invite_before_signup` trigger on `auth.users` (migration 027),
 * which is cloud-only and never ships in core-migrations — so calling
 * signUp() directly here is the intended path, not a bypass.
 *
 * The compose stack sets GOTRUE_MAILER_AUTOCONFIRM=true, so the account is
 * live immediately and signUp() returns a session; the redirect effect in
 * SignupPage picks it up. The timed navigate below is a fallback for the case
 * where confirmation is later turned on and no session comes back.
 */
function SelfHostSignup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (signUpError) throw signUpError;
      track("user_signed_up", { method: "self_host" });
      setDone(true);
      setTimeout(() => navigate({ to: "/console" }), 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      backTo="/login"
      backLabel="Sign in instead"
      title="Create your account"
      subtitle="Set up the first account on this Leenar instance."
    >
      {error && (
        <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {done ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-secondary/20 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          <p className="text-sm font-medium">Account created!</p>
          <p className="text-xs text-muted-foreground">
            Redirecting to console…
          </p>
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
          <AuthSubmit type="submit" disabled={loading}>
            {loading ? "Creating account…" : "Create account →"}
          </AuthSubmit>
        </form>
      )}
    </AuthShell>
  );
}
