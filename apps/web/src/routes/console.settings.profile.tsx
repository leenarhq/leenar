import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
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
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Profile"
          subtitle="Manage your account identity."
        />

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

        <div className="mt-6 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-lg font-semibold">
            {initial}
          </div>
          <div className="text-xs text-muted-foreground">
            Signed in via{" "}
            <span className="font-mono text-foreground">{provider}</span>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          <Field label="Full name">
            <div className="flex gap-2">
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <SaveBtn onClick={saveName} loading={savingName} />
            </div>
          </Field>

          <Field label="Email address">
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <SaveBtn
                onClick={saveEmail}
                loading={savingEmail}
                disabled={newEmail === user?.email}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Changing your email requires confirmation via a link.
            </p>
          </Field>
        </div>
      </div>
    </SettingsShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
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
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm hover:bg-secondary disabled:opacity-50"
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
    </button>
  );
}
