import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";
import { PasswordStrength } from "../components/auth-shell";

export const Route = createFileRoute("/console/settings/security")({
  component: SecurityPage,
  head: () => ({ meta: [{ title: "Security — Leenar Console" }] }),
});

function SecurityPage() {
  const { user } = useAuth();
  const provider = (user?.app_metadata?.provider as string) ?? "email";
  const isEmailAccount = provider === "email";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Reauthentication (OTP)
  const [reauthSent, setReauthSent] = useState(false);
  const [reauthCode, setReauthCode] = useState("");
  const [reauthBusy, setReauthBusy] = useState(false);
  const [reauthMsg, setReauthMsg] = useState<string | null>(null);

  const strength =
    password.length === 0
      ? 0
      : password.length < 8
        ? 1
        : password.length < 12
          ? 2
          : 3;

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    if (password !== confirm) return setErr("Passwords do not match.");
    if (password.length < 8)
      return setErr("Password must be at least 8 characters.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) setErr(error.message);
    else {
      setMsg("Password updated.");
      setPassword("");
      setConfirm("");
    }
  };

  const sendReauth = async () => {
    setReauthMsg(null);
    setReauthBusy(true);
    const { error } = await supabase.auth.reauthenticate();
    setReauthBusy(false);
    if (error) setReauthMsg(error.message);
    else setReauthSent(true);
  };

  const verifyReauth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reauthCode || !user?.email) return;
    setReauthBusy(true);
    setReauthMsg(null);
    const { error } = await supabase.auth.verifyOtp({
      email: user.email,
      token: reauthCode,
      type: "reauthentication",
    });
    setReauthBusy(false);
    if (error) setReauthMsg(error.message);
    else {
      setReauthMsg("Re-authenticated.");
      setReauthSent(false);
      setReauthCode("");
    }
  };

  return (
    <SettingsShell title="Security">
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Security"
          subtitle="Manage your password and account verification."
        />

        {!isEmailAccount ? (
          <div className="mt-6 flex items-center gap-3 rounded-md border border-border bg-secondary/20 px-4 py-3 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            You signed in via{" "}
            <span className="font-mono text-foreground">{provider}</span>.
            Password is managed by your provider.
          </div>
        ) : (
          <>
            {msg && (
              <p className="mt-4 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
                {msg}
              </p>
            )}
            {err && (
              <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {err}
              </p>
            )}

            <form onSubmit={changePassword} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <PasswordStrength strength={strength} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{" "}
                Update password
              </button>
            </form>

            <div className="mt-10 border-t border-dashed border-border pt-6">
              <h2 className="font-serif text-lg">Re-authenticate</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Verify a one-time code emailed to you for sensitive changes.
              </p>
              {reauthMsg && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {reauthMsg}
                </p>
              )}
              {!reauthSent ? (
                <button
                  onClick={sendReauth}
                  disabled={reauthBusy}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
                >
                  {reauthBusy && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}{" "}
                  Send code
                </button>
              ) : (
                <form onSubmit={verifyReauth} className="mt-3 flex gap-2">
                  <input
                    value={reauthCode}
                    onChange={(e) => setReauthCode(e.target.value)}
                    placeholder="6-digit code"
                    className="w-40 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={reauthBusy}
                    className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background hover:opacity-90 disabled:opacity-50"
                  >
                    {reauthBusy && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}{" "}
                    Verify
                  </button>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </SettingsShell>
  );
}
