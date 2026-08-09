import { createFileRoute } from "@tanstack/react-router";
import { SettingsShell, SettingsHeader } from "../components/settings-shell";

// Core stub: notification routing is not included in this build. The route is
// kept so the settings nav links still resolve.
export const Route = createFileRoute("/console/settings/notifications")({
  component: NotificationsPlaceholder,
  head: () => ({ meta: [{ title: "Notifications" }] }),
});

function NotificationsPlaceholder() {
  return (
    <SettingsShell title="Notifications">
      <div className="max-w-2xl flex-1 p-8">
        <SettingsHeader
          title="Notifications"
          subtitle="Route alerts to the right place."
        />
        <div className="mt-6 rounded-xl border border-dashed border-border bg-background/60 p-6 text-sm text-muted-foreground">
          Notification routing is not available in this build.
        </div>
      </div>
    </SettingsShell>
  );
}
