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
import { useIsMobile } from "../hooks/use-mobile";

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
  const isMobile = useIsMobile();

  return (
    <>
      <ConsoleTopBar title={title} />
      <div
        className={`flex flex-1 ${isMobile ? "flex-col overflow-hidden" : ""}`}
      >
        {isMobile ? (
          <MobileNavStrip pathname={pathname} />
        ) : (
          <aside className="w-56 shrink-0 border-r border-border p-3">
            <Link
              to="/console"
              className="mb-4 flex items-center gap-2 rounded-full px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
            <NavGroup label="Account" items={account} pathname={pathname} />
            <NavGroup label="Developer" items={developer} pathname={pathname} />
            <NavGroup label="Danger" items={danger} pathname={pathname} />
          </aside>
        )}
        <div className="flex flex-1 flex-col overflow-auto">{children}</div>
      </div>
    </>
  );
}

// Mobile settings nav: a single horizontally-scrollable pill strip instead
// of the desktop's w-56 side column — switching between settings sub-pages
// is frequent enough that a drawer (extra tap to open/close) would be worse
// than a persistent, native-feeling top strip.
function MobileNavStrip({ pathname }: { pathname: string }) {
  const allItems = [...account, ...developer, ...danger];
  return (
    <nav className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
      <Link
        to="/console"
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
      {allItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.to;
        return (
          <Link
            key={item.label}
            to={item.to}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors ${
              active
                ? "border-foreground bg-secondary text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {item.label}
          </Link>
        );
      })}
    </nav>
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
      <div className="px-3 pb-2 pt-3 font-mono text-[10px] lowercase tracking-wide text-dim">
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
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors ${
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

/**
 * The subtitle line inside a settings route. It does NOT render the page
 * name: SettingsShell already passes it to ConsoleTopBar, which renders it
 * in the PageBar directly above this. Two copies of the same word is what
 * this component used to do.
 *
 * `title` is still accepted so the eight callers keep compiling while they
 * are converted one at a time; it is ignored, and every call site drops it.
 */
export function SettingsHeader({
  subtitle,
  action,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  if (!subtitle && !action) return null;
  return (
    <div className="flex items-start justify-between gap-4 pb-2">
      {subtitle && (
        <p className="text-[13px] text-muted-foreground">{subtitle}</p>
      )}
      {action}
    </div>
  );
}
