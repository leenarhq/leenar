import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import {
  LayoutGrid,
  Settings,
  Plug,
  PanelLeft,
  Plus,
  BookOpen,
  LifeBuoy,
  Sun,
  Monitor,
  Moon,
  ChevronsUpDown,
  LayoutTemplate,
  Bell,
  MessageSquare,
  Rss,
  X,
  MoreHorizontal,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/auth";
import { useIsMobile } from "../hooks/use-mobile";
import { getNotificationCount } from "../lib/api";
import { isTabHidden } from "../lib/visibility";
import { getChats, deleteChat, getProjects, type Chat } from "../lib/workflows";
import { FeedbackModal } from "../components/dashboard/FeedbackModal";
import { LeenarMark } from "../components/auth-shell";
import { MobileDrawer } from "../components/mobile-drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "../components/ui/tooltip";
import { projectRailItems, isRailItemActive } from "../lib/projectRail";
import { StatusDot } from "../components/dashboard/Panel";
import { statusLabel } from "../lib/labels";
import { isCloud } from "../lib/cloud";
import { GuidedSetup } from "../components/setup/GuidedSetup";

export const Route = createFileRoute("/console")({
  component: ConsoleLayout,
  head: () => ({
    meta: [
      { title: "Console — Leenar" },
      {
        name: "description",
        content: "Manage projects, deployments, and settings on Leenar.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
});

type NavItem = {
  label: string;
  icon: typeof LayoutGrid;
  to?:
    | "/console"
    | "/console/new"
    | "/console/deployments"
    | "/console/logs"
    | "/console/settings/api-tokens"
    | "/console/integrations"
    | "/console/templates";
  exact?: boolean;
  match?: string;
  disabled?: boolean;
};

const mainNav: NavItem[] = [
  {
    to: "/console/integrations",
    label: "Integrations",
    icon: Plug,
    match: "/console/integrations",
  },
  {
    to: "/console/new",
    label: "New Project",
    icon: Plus,
    match: "/console/new",
  },
  {
    to: "/console/templates",
    label: "Templates",
    icon: LayoutTemplate,
    match: "/console/templates",
  },
  {
    to: "/console/settings/api-tokens",
    label: "Settings",
    icon: Settings,
    match: "/console/settings",
  },
];

// Lets ConsoleTopBar/ProjectContextBar (rendered from route files far from
// ConsoleLayout) open the mobile nav drawer that ConsoleLayout owns the
// open/close state for.
const ConsoleShellContext = createContext<{
  mobileNavOpen: boolean;
  openMobileNav: () => void;
  setMobileNavOpen: (open: boolean) => void;
} | null>(null);

function useConsoleShell() {
  const ctx = useContext(ConsoleShellContext);
  if (!ctx) {
    // Defensive fallback (should never happen — every console.* route is
    // nested under ConsoleLayout's provider) so a missing provider degrades
    // to a no-op toggle instead of crashing the page.
    return {
      mobileNavOpen: false,
      openMobileNav: () => {},
      setMobileNavOpen: () => {},
    };
  }
  return ctx;
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">(() => {
    if (typeof window === "undefined") return "dark";
    return (
      (localStorage.getItem("leenar_theme") as "light" | "dark" | "system") ??
      "dark"
    );
  });

  const applyTheme = (t: "light" | "dark" | "system") => {
    const prefersLight = window.matchMedia(
      "(prefers-color-scheme: light)",
    ).matches;
    const light = t === "light" || (t === "system" && prefersLight);
    document.documentElement.classList.toggle("light", light);
    localStorage.setItem("leenar_theme", t);
    setTheme(t);
  };

  return { theme, applyTheme };
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function AccountDropdownContent({
  activeProjectId,
  onLogout,
  side = "top",
}: {
  activeProjectId: string | null;
  onLogout: () => void;
  side?: "top" | "right";
}) {
  return (
    <DropdownMenuContent side={side} align="start" className="w-56">
      {activeProjectId && (
        <DropdownMenuItem asChild>
          <Link
            to="/console/projects/$id/logs"
            params={{ id: activeProjectId }}
          >
            Service Logs
          </Link>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem asChild>
        <Link to="/console/integrations">Integrations</Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/console/settings/profile">Settings</Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onClick={onLogout}
        className="text-destructive focus:text-destructive"
      >
        Log out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search });
  const navigate = useNavigate();
  const { user, session, signOut } = useAuth();
  const isMobile = useIsMobile();
  const projectMatch = pathname.match(/^\/console\/projects\/([^/]+)/);
  const activeProjectId = projectMatch?.[1] ?? null;
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    user?.email?.split("@")[0] ??
    "Account";
  const initial = displayName.charAt(0).toUpperCase();
  const currentChatId =
    (search as unknown as Record<string, string>).chatId ?? null;

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
    enabled: !!activeProjectId,
    staleTime: 30_000,
  });
  const isLive =
    projects?.find((p) => p.id === activeProjectId)?.status === "active";

  const [chats, setChats] = useState<Chat[]>([]);
  const chatsLoadedRef = useRef(false);
  const [notifCount, setNotifCount] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    // /api/notifications is cloud-only; without this the self-host console
    // would 404 every 30 seconds for a badge that can never be non-zero.
    if (!isCloud || !session) return;
    const fetchCount = () => {
      getNotificationCount(session)
        .then((d) => setNotifCount(d.total))
        .catch(() => {});
    };
    fetchCount();
    const id = setInterval(() => {
      if (isTabHidden()) return;
      fetchCount();
    }, 30_000);
    return () => clearInterval(id);
  }, [session]);

  useEffect(() => {
    if (!user) return;
    getChats()
      .then(setChats)
      .catch(() => {});
    chatsLoadedRef.current = true;
  }, [user, pathname, currentChatId]);

  const { mobileNavOpen, setMobileNavOpen } = useConsoleShell();

  if (isMobile) {
    // Below the 768px breakpoint there is no persistent rail/full sidebar —
    // both the project-context and non-project variants collapse into one
    // drawer, opened via the PanelLeft button wired up in
    // ConsoleTopBar/ProjectContextBar.
    return (
      <MobileDrawer
        open={mobileNavOpen}
        onOpenChange={setMobileNavOpen}
        title="Console navigation"
      >
        <MobileNavContent
          activeProjectId={activeProjectId}
          isLive={isLive}
          pathname={pathname}
          displayName={displayName}
          initial={initial}
          onNavigate={() => setMobileNavOpen(false)}
          onLogout={async () => {
            await signOut();
            navigate({ to: "/login" });
          }}
        />
      </MobileDrawer>
    );
  }

  if (activeProjectId) {
    const railItems = projectRailItems(!!isLive);
    return (
      <aside className="flex w-14 shrink-0 flex-col items-center border-r border-dashed border-border bg-background py-3">
        <Link
          to="/"
          title="Leenar"
          className="mb-2 flex h-9 w-9 items-center justify-center"
        >
          <LeenarMark className="h-4 w-auto" />
        </Link>
        <TooltipProvider delayDuration={0}>
          <nav className="flex flex-1 flex-col items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/console"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Projects</TooltipContent>
            </Tooltip>
            {railItems.map((item) => {
              const Icon = item.icon;
              const active = isRailItemActive(
                pathname,
                activeProjectId,
                item.key,
              );
              return (
                <Tooltip key={item.key}>
                  <TooltipTrigger asChild>
                    <Link
                      to={item.to}
                      params={{ id: activeProjectId }}
                      className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                        active
                          ? "bg-secondary text-foreground"
                          : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </nav>
        </TooltipProvider>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title={displayName}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold hover:bg-secondary/80"
            >
              {initial}
            </button>
          </DropdownMenuTrigger>
          <AccountDropdownContent
            activeProjectId={activeProjectId}
            onLogout={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
            side="right"
          />
        </DropdownMenu>
        <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-dashed border-border bg-background">
      <div className="flex h-[57px] items-center gap-2 border-b border-dashed border-border px-4">
        <Link to="/console" className="flex items-center gap-2">
          <LeenarMark className="h-4 w-auto" />
          <span className="font-serif text-base">Leenar</span>
          <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            CONSOLE
          </span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {mainNav.map((item) => {
          const Icon = item.icon;
          if (item.disabled || !item.to) {
            return (
              <div
                key={item.label}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </div>
            );
          }
          const active = item.exact
            ? pathname === item.to
            : pathname.startsWith(item.match ?? item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isCloud && (
          <a
            // Absolute, not a router link: the blog is a cloud-only marketing
            // route, and the core build ships this console without it.
            href="https://leenar.net/blog"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <Rss className="h-4 w-4" />
            Blog
          </a>
        )}
      </nav>
      {!isMobile && chats.length > 0 && (
        <div className="border-t border-dashed border-border p-2">
          <span className="block px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Recent
          </span>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {chats.map((chat) => {
              const isActive = currentChatId === chat.id;
              return (
                <div key={chat.id} className="group flex items-center gap-1">
                  <Link
                    to="/console/new"
                    search={{ chatId: chat.id }}
                    title={chat.name}
                    className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    <span className="truncate">{chat.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {relTime(chat.updated_at)}
                    </span>
                  </Link>
                  <button
                    title="Delete"
                    onClick={async (e) => {
                      e.preventDefault();
                      await deleteChat(chat.id).catch(() => {});
                      setChats((prev) => prev.filter((c) => c.id !== chat.id));
                      if (isActive)
                        navigate({ to: "/console/new", search: {} });
                    }}
                    className="hidden shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 sm:block"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex items-center gap-1 border-t border-dashed border-border px-3 pt-2">
        <button
          onClick={() => setFeedbackOpen(true)}
          title="Feedback"
          className="inline-flex items-center gap-1.5 rounded-md bg-secondary/50 px-2 py-1 text-xs text-foreground transition-colors hover:bg-secondary"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Feedback
        </button>
        {notifCount > 0 && (
          <button
            onClick={() => navigate({ to: "/console" })}
            title={`${notifCount} open issue${notifCount !== 1 ? "s" : ""}`}
            className="relative ml-auto inline-flex items-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            <Bell className="h-3.5 w-3.5" />
            <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
          </button>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2 border-t border-dashed border-border p-3 text-left hover:bg-secondary/40">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{displayName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {user?.email ?? ""}
              </div>
            </div>
            <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <AccountDropdownContent
          activeProjectId={activeProjectId}
          onLogout={async () => {
            await signOut();
            navigate({ to: "/login" });
          }}
          side="top"
        />
      </DropdownMenu>
      <FeedbackModal open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </aside>
  );
}

// The mobile drawer's contents: unlike the desktop rail/full split, this
// combines global console navigation with the active project's tabs (if
// any) into one scrollable list, so a mobile user can reach both without
// switching drawers.
function MobileNavContent({
  activeProjectId,
  isLive,
  pathname,
  displayName,
  initial,
  onNavigate,
  onLogout,
}: {
  activeProjectId: string | null;
  isLive: boolean;
  pathname: string;
  displayName: string;
  initial: string;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const navLinkClass = (active: boolean) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
      active
        ? "bg-secondary text-foreground"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[57px] shrink-0 items-center gap-2 border-b border-dashed border-border px-4">
        <LeenarMark className="h-4 w-auto" />
        <span className="font-serif text-base">Leenar</span>
        <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          CONSOLE
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        <span className="block px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          Console
        </span>
        <Link
          to="/console"
          onClick={onNavigate}
          className={navLinkClass(pathname === "/console")}
        >
          <LayoutGrid className="h-4 w-4" />
          Projects
        </Link>
        {mainNav.map((item) => {
          const Icon = item.icon;
          if (item.disabled || !item.to) return null;
          const active = item.exact
            ? pathname === item.to
            : pathname.startsWith(item.match ?? item.to);
          return (
            <Link
              key={item.label}
              to={item.to}
              onClick={onNavigate}
              className={navLinkClass(active)}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
        {isCloud && (
          <a
            href="https://leenar.net/blog"
            target="_blank"
            rel="noopener noreferrer"
            className={navLinkClass(false)}
          >
            <Rss className="h-4 w-4" />
            Blog
          </a>
        )}

        {activeProjectId && (
          <>
            <span className="block px-3 pb-1 pt-4 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Project
            </span>
            {projectRailItems(isLive).map((item) => {
              const Icon = item.icon;
              const active = isRailItemActive(
                pathname,
                activeProjectId,
                item.key,
              );
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  params={{ id: activeProjectId }}
                  onClick={onNavigate}
                  className={navLinkClass(active)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full shrink-0 items-center gap-2 border-t border-dashed border-border p-3 text-left hover:bg-secondary/40">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-semibold">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{displayName}</div>
            </div>
            <ChevronsUpDown className="h-3 w-3 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <AccountDropdownContent
          activeProjectId={activeProjectId}
          onLogout={onLogout}
          side="top"
        />
      </DropdownMenu>
    </div>
  );
}

// Docs/Support links + theme toggle collapsed into one overflow menu — the
// full row (~260px) doesn't fit next to a title and PanelLeft button on a
// 360-390px header.
function TopBarActionsMobile() {
  const { theme, applyTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="More"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem asChild>
          <a href="#">
            <BookOpen className="h-3.5 w-3.5" /> Docs
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="#">
            <LifeBuoy className="h-3.5 w-3.5" /> Support
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => applyTheme("light")}>
          <Sun className="h-3.5 w-3.5" /> Light
          {theme === "light" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme("system")}>
          <Monitor className="h-3.5 w-3.5" /> System
          {theme === "system" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => applyTheme("dark")}>
          <Moon className="h-3.5 w-3.5" /> Dark
          {theme === "dark" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBarActions() {
  const { theme, applyTheme } = useTheme();
  const isMobile = useIsMobile();

  if (isMobile) return <TopBarActionsMobile />;

  return (
    <>
      <a
        href="#"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <BookOpen className="h-3.5 w-3.5" /> Docs
      </a>
      <a
        href="#"
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <LifeBuoy className="h-3.5 w-3.5" /> Support
      </a>
      <div className="ml-2 flex items-center gap-1 rounded-md border border-border p-0.5">
        <button
          onClick={() => applyTheme("light")}
          className={`rounded p-1 transition-colors ${theme === "light" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Sun className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => applyTheme("system")}
          className={`rounded p-1 transition-colors ${theme === "system" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Monitor className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => applyTheme("dark")}
          className={`rounded p-1 transition-colors ${theme === "dark" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <Moon className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  );
}

export function ConsoleTopBar({
  title,
  right,
}: {
  title: ReactNode;
  right?: ReactNode;
}) {
  const isMobile = useIsMobile();
  const { openMobileNav } = useConsoleShell();
  return (
    <header className="flex h-[57px] items-center justify-between border-b border-dashed border-border px-3 sm:px-6">
      <div className="flex items-center gap-3">
        {isMobile && (
          <button
            aria-label="Open navigation"
            onClick={openMobileNav}
            className="text-muted-foreground hover:text-foreground"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <span className="truncate text-sm">{title}</span>
      </div>
      <div className="flex items-center gap-2">
        {right}
        <TopBarActions />
      </div>
    </header>
  );
}

const projectStatusTone: Record<string, string> = {
  active: "success",
  draft: "neutral",
  error: "error",
};

export function ProjectContextBar({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { openMobileNav } = useConsoleShell();
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: getProjects,
    staleTime: 30_000,
  });
  const project = projects?.find((p) => p.id === projectId);
  const status = project?.status ?? "draft";
  return (
    <header className="flex h-[57px] items-center justify-between border-b border-dashed border-border px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-1 sm:gap-3">
        {isMobile && (
          <button
            aria-label="Open navigation"
            onClick={openMobileNav}
            className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-secondary/50">
              <span className="truncate font-medium">
                {project?.name ?? projectId}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {(projects ?? []).map((p) => (
              <DropdownMenuItem
                key={p.id}
                onClick={() =>
                  navigate({
                    to: "/console/projects/$id/canvas",
                    params: { id: p.id },
                  })
                }
              >
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="hidden shrink-0 items-center gap-1.5 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">
          <StatusDot tone={projectStatusTone[status] ?? "neutral"} />
          {statusLabel(status)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <TopBarActions />
      </div>
    </header>
  );
}

function ConsoleLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  // Re-apply correct theme on every console mount — overrides .light set by landing page
  useEffect(() => {
    const pref =
      (localStorage.getItem("leenar_theme") as
        | "light"
        | "dark"
        | "system"
        | null) ?? "dark";
    const prefersLight = window.matchMedia(
      "(prefers-color-scheme: light)",
    ).matches;
    const light = pref === "light" || (pref === "system" && prefersLight);
    document.documentElement.classList.toggle("light", light);
  }, []);

  // While auth is resolving (or redirecting), avoid flashing the console shell.
  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <ConsoleShellContext.Provider
      value={{
        mobileNavOpen,
        openMobileNav: () => setMobileNavOpen(true),
        setMobileNavOpen,
      }}
    >
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <div className="flex flex-1 flex-col h-full min-w-0 overflow-hidden">
          <Outlet />
        </div>
        <GuidedSetup />
      </div>
    </ConsoleShellContext.Provider>
  );
}
