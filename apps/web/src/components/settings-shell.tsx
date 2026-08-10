import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  User,
  Shield,
  Palette,
  Bell,
  History,
  Key,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import type { ReactNode } from "react";
import { ConsoleTopBar } from "../routes/console";
import { isCloud } from "../lib/cloud";

type SettingsRoute =
  | "/console/settings/profile"
  | "/console/settings/security"
  | "/console/settings/appearance"
  | "/console/settings/notifications"
  | "/console/settings/activity"
  | "/console/settings/api-tokens"
  | "/console/settings/channels"
  | "/console/settings/danger";

type Item = { to: SettingsRoute; label: string; icon: typeof User };

const account: Item[] = [
  { to: "/console/settings/profile", label: "Profile", icon: User },
  { to: "/console/settings/security", label: "Security", icon: Shield },
  { to: "/console/settings/appearance", label: "Appearance", icon: Palette },
  ...(isCloud
    ? [
        {
          to: "/console/settings/notifications",
          label: "Notifications",
          icon: Bell,
        } as Item,
      ]
    : []),
  // Activity reads /api/audit-log, a cloud-only router. Core still WRITES
  // audit rows (user_audit_log ships in core-migrations 0008) — only the read
  // endpoint is missing, so this is a hide, not a data gap.
  ...(isCloud
    ? [
        {
          to: "/console/settings/activity",
          label: "Activity",
          icon: History,
        } as Item,
      ]
    : []),
];
const developer: Item[] = [
  { to: "/console/settings/api-tokens", label: "API Tokens", icon: Key },
  ...(isCloud
    ? [
        {
          to: "/console/settings/channels",
          label: "Channels",
          icon: MessageSquare,
        } as Item,
      ]
    : []),
];
const danger: Item[] = [
  { to: "/console/settings/danger", label: "Danger Zone", icon: AlertTriangle },
];

export function SettingsShell({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <>
      <ConsoleTopBar title={title} />
      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-dashed border-border p-3">
          <Link
            to="/console"
            className="mb-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <NavGroup label="Account" items={account} pathname={pathname} />
          <NavGroup label="Developer" items={developer} pathname={pathname} />
          <NavGroup label="Danger" items={danger} pathname={pathname} />
        </aside>
        <div className="flex flex-1 flex-col overflow-auto">{children}</div>
      </div>
    </>
  );
}

function NavGroup({
  label,
  items,
  pathname,
}: {
  label: string;
  items: Item[];
  pathname: string;
}) {
  return (
    <>
      <div className="px-3 pb-2 pt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}

/** Shared page header inside a settings route. */
export function SettingsHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <h1 className="font-serif text-2xl">{title}</h1>
        {subtitle && (
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}
