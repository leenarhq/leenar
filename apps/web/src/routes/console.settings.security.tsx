import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import {
  Field,
  FieldGroup,
  INPUT,
  PILL,
  PILL_QUIET,
} from "../components/console/Field";
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
        <SettingsHeader subtitle="Manage your password and account verification." />

        {!isEmailAccount ? (
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-border-soft px-4 py-3 text-[13px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            You signed in via{" "}
            <span className="font-mono text-foreground">{provider}</span>.
            Password is managed by your provider.
          </div>
        ) : (
          <>
            {msg && (
              <p className="mt-4 rounded-xl border border-ok/30 px-3 py-2 text-[13px] text-ok">
                {msg}
              </p>
            )}
            {err && (
              <p className="mt-4 rounded-xl border border-crit/30 px-3 py-2 text-[13px] text-crit">
                {err}
              </p>
            )}

            <form onSubmit={changePassword} className="mt-6">
              <FieldGroup>
                <Field label="New password">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={INPUT}
                  />
                  <PasswordStrength strength={strength} />
                </Field>
                <Field label="Confirm password">
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={INPUT}
                  />
                </Field>
              </FieldGroup>
              <button
                type="submit"
                disabled={saving}
                className={`mt-4 ${PILL}`}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{" "}
                Update password
              </button>
            </form>

            <div className="mt-10 border-t border-border-soft pt-6">
              <h2 className="text-[15px] font-medium">Re-authenticate</h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Verify a one-time code emailed to you for sensitive changes.
              </p>
              {reauthMsg && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  {reauthMsg}
                </p>
              )}
              {!reauthSent ? (
                <button
                  onClick={sendReauth}
                  disabled={reauthBusy}
                  className={`mt-3 ${PILL_QUIET}`}
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
                    className={`w-40 ${INPUT}`}
                  />
                  <button type="submit" disabled={reauthBusy} className={PILL}>
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
