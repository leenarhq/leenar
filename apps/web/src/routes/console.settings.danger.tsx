import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";
import { useAuth } from "../context/auth";
import { supabase } from "../lib/supabase";

export const Route = createFileRoute("/console/settings/danger")({
  component: DangerPage,
  head: () => ({ meta: [{ title: "Danger Zone — Leenar Console" }] }),
});

const CONFIRM_PHRASE = "delete my account";

function DangerPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const deleteAccount = async () => {
    if (confirm !== CONFIRM_PHRASE) return;
    setBusy(true);
    setErr(null);
    try {
      const { error } = await supabase.functions.invoke("delete-user");
      if (error) throw error;
      await signOut();
      navigate({ to: "/login" });
    } catch (e: any) {
      setErr(e.message ?? "Failed to delete account. Contact support.");
      setBusy(false);
    }
  };

  return (
    <SettingsShell title="Danger Zone">
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Danger Zone"
          subtitle="Irreversible and destructive actions."
        />

        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/5 p-5">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> Delete account
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Permanently removes your account, all projects, and integrations.
            This cannot be undone.
          </p>
          {err && <p className="mt-3 text-sm text-destructive">{err}</p>}
          <p className="mt-4 text-xs text-muted-foreground">
            Type{" "}
            <span className="font-mono text-foreground">{CONFIRM_PHRASE}</span>{" "}
            to confirm.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              className="flex-1 rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={deleteAccount}
              disabled={busy || confirm !== CONFIRM_PHRASE}
              className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Delete
            </button>
          </div>
        </div>
      </div>
    </SettingsShell>
  );
}
