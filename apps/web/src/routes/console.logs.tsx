import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  FileText,
  ArrowLeftRight,
  LineChart,
  Bell,
  Plug,
  Layers,
} from "lucide-react";
import type { ReactNode } from "react";
import { ConsoleTopBar } from "./console";
import { useIsMobile } from "../hooks/use-mobile";
import { StateTag } from "../components/console/StateTag";
import { PILL_QUIET } from "../components/console/Field";

const subNav = {
  monitor: [
    { to: "/console/logs", label: "Runtime Logs", icon: FileText },
    {
      to: "/console/logs/http",
      label: "HTTP Logs",
      icon: ArrowLeftRight,
      disabled: true,
    },
    {
      to: "/console/logs/metrics",
      label: "Metrics",
      icon: LineChart,
      disabled: true,
    },
  ],
  manage: [
    { label: "Alerts", icon: Bell, disabled: true },
    { label: "Integrations", icon: Plug, disabled: true },
  ],
};

export function ObservabilitySidebar({
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
            <div className="px-3 pb-2 pt-3 font-mono text-[10px] lowercase tracking-wide text-dim">
              Monitor
            </div>
            <div className="space-y-1">
              {subNav.monitor.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.to;
                if (item.disabled) {
                  return (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-dim"
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="h-4 w-4" /> {item.label}
                      </span>
                      <StateTag tone="idle" label="soon" />
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] transition-colors ${active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    <Icon className="h-4 w-4" /> {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="px-3 pb-2 pt-4 font-mono text-[10px] lowercase tracking-wide text-dim">
              Manage
            </div>
            <div className="space-y-1">
              {subNav.manage.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-dim"
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" /> {item.label}
                    </span>
                    <StateTag tone="idle" label="soon" />
                  </div>
                );
              })}
            </div>
          </aside>
        )}
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </>
  );
}

// Mobile: same horizontal pill-strip pattern as SettingsShell. Disabled
// ("SOON") items are shown as muted, non-tappable pills rather than dropped
// entirely, so the strip still communicates what's coming.
function MobileNavStrip({ pathname }: { pathname: string }) {
  const items = [...subNav.monitor, ...subNav.manage];
  return (
    <nav className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border px-3 py-2">
      <Link
        to="/console"
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </Link>
      {items.map((item) => {
        const Icon = item.icon;
        if (item.disabled || !("to" in item) || !item.to) {
          return (
            <span
              key={item.label}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-soft px-3 py-1.5 text-xs text-dim"
            >
              <Icon className="h-3.5 w-3.5" /> {item.label}
            </span>
          );
        }
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

export const Route = createFileRoute("/console/logs")({
  component: LogsPage,
  head: () => ({ meta: [{ title: "Runtime Logs — Leenar Console" }] }),
});

function LogsPage() {
  return (
    <ObservabilitySidebar title="Runtime Logs">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <div className="text-[13px] font-medium">
            Logs live inside each project
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Runtime logs, metrics, and alerts stream per app — open a project to
            see its live observability. An all-apps rollup view is on the way.
          </p>
          <Link to="/console" className={`mt-4 ${PILL_QUIET}`}>
            <Layers className="h-3.5 w-3.5" /> Open a project
          </Link>
        </div>
      </div>
    </ObservabilitySidebar>
  );
}
