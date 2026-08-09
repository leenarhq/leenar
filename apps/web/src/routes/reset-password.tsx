import { useState, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { clearRecovery } from "../lib/recovery";
import {
  AuthShell,
  AuthField,
  AuthSubmit,
  PasswordStrength,
} from "../components/auth-shell";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ name: "robots", content: "noindex, nofollow" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    const timeout = setTimeout(() => setExpired(true), 5000);
    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      await supabase.auth.signOut();
      clearRecovery();
      setTimeout(() => navigate({ to: "/login" }), 2500);
    } catch (err: any) {
      setError(err.message ?? "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength =
    password.length === 0
      ? 0
      : password.length < 8
        ? 1
        : password.length < 12
          ? 2
          : 3;

  return (
    <AuthShell
      backTo="/login"
      backLabel="Back to sign in"
      title="Set new password"
      subtitle="Choose a strong password for your account."
    >
      {done ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-secondary/20 px-4 py-8 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-400" />
          <p className="text-sm font-medium">Password updated</p>
          <p className="text-xs text-muted-foreground">
            Redirecting you to sign in…
          </p>
        </div>
      ) : !ready ? (
        <div className="rounded-md border border-border bg-secondary/20 px-4 py-8 text-center">
          {expired ? (
            <>
              <p className="text-sm font-medium text-destructive">
                Link expired
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This reset link has expired or already been used.
              </p>
              <Link
                to="/login"
                className="mt-4 inline-block rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90"
              >
                Request a new link
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Validating reset link…
            </p>
          )}
        </div>
      ) : (
        <>
          {error && (
            <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <AuthField
                id="password"
                label="New password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <PasswordStrength strength={passwordStrength} />
            </div>
            <AuthField
              id="confirm"
              label="Confirm password"
              type="password"
              placeholder="••••••••"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
            />
            <AuthSubmit type="submit" disabled={loading}>
              {loading ? "Updating…" : "Update password"}
            </AuthSubmit>
          </form>
        </>
      )}
    </AuthShell>
  );
}
