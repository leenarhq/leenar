import { createFileRoute } from "@tanstack/react-router";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";

// Core stub: chat-channel routing is not included in this build. The route is
// kept so the settings nav links still resolve.
export const Route = createFileRoute("/console/settings/channels")({
  component: ChannelsPlaceholder,
  head: () => ({ meta: [{ title: "Channels" }] }),
});

function ChannelsPlaceholder() {
  return (
    <SettingsShell title="Channels">
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Channels"
          subtitle="Connect chat channels to your workspace."
        />
        <div className="mt-6 rounded-xl border border-dashed border-border bg-background/60 p-6 text-sm text-muted-foreground">
          Chat channels (Slack, WhatsApp) are not available in this build.
        </div>
      </div>
    </SettingsShell>
  );
}
