import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import { Field, FieldGroup, INPUT, PILL } from "../components/console/Field";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";

export const Route = createFileRoute("/console/settings/profile")({
  component: ProfilePage,
  head: () => ({ meta: [{ title: "Profile — Leenar Console" }] }),
});

function ProfilePage() {
  const { user } = useAuth();
  const [name, setName] = useState(
    (user?.user_metadata?.full_name as string) ?? "",
  );
  const [newEmail, setNewEmail] = useState(user?.email ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const provider = (user?.app_metadata?.provider as string) ?? "email";
  const initial = (name || user?.email || "?").charAt(0).toUpperCase();

  const saveName = async () => {
    setSavingName(true);
    setMsg(null);
    setErr(null);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: name },
    });
    setSavingName(false);
    if (error) setErr(error.message);
    else setMsg("Name updated.");
  };

  const saveEmail = async () => {
    if (newEmail === user?.email) return;
    setSavingEmail(true);
    setMsg(null);
    setErr(null);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setSavingEmail(false);
    if (error) setErr(error.message);
    else setMsg("Confirmation link sent to your new email.");
  };

  return (
    <SettingsShell title="Profile">
      <div className="max-w-2xl flex-1 p-5 sm:p-8">
        <SettingsHeader subtitle="Manage your account identity." />

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

        <div className="mt-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-lg font-medium">
            {initial}
          </div>
          <div className="text-[13px] text-muted-foreground">
            Signed in via{" "}
            <span className="font-mono text-foreground">{provider}</span>
          </div>
        </div>

        <div className="mt-6">
          <FieldGroup>
            <Field label="Full name">
              <div className="flex gap-2">
                <input
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  className={INPUT}
                />
                <SaveBtn onClick={saveName} loading={savingName} />
              </div>
            </Field>
            <Field
              label="Email address"
              hint="Changing your email requires confirmation via a link."
            >
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className={INPUT}
                />
                <SaveBtn
                  onClick={saveEmail}
                  loading={savingEmail}
                  disabled={newEmail === user?.email}
                />
              </div>
            </Field>
          </FieldGroup>
        </div>
      </div>
    </SettingsShell>
  );
}

function SaveBtn({
  onClick,
  loading,
  disabled,
}: {
  onClick: () => void;
  loading: boolean;
  disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={loading || disabled} className={PILL}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
    </button>
  );
}
