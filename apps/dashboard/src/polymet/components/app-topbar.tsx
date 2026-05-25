import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  PanelLeftIcon,
  SearchIcon,
  SunIcon,
  MoonIcon,
  BellIcon,
  ChevronRightIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  InfoIcon,
  NewspaperIcon,
  BoxIcon,
  TerminalIcon,
  SettingsIcon,
} from "lucide-react";
import { useSidebar } from "@/polymet/hooks/use-sidebar";
import { type Instance } from "@/polymet/data/dashboard-data";
import { useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { listNotifications, markNotificationsRead, type NotificationEvent } from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";
import { getCurrentWasupTheme, persistWasupTheme } from "@/polymet/lib/theme";

const MOBILE_NAV = [
  { to: "/", label: "Home", icon: NewspaperIcon },
  { to: "/instances", label: "Instances", icon: BoxIcon },
  { to: "/connection", label: "Connection", icon: TerminalIcon },
  { to: "/deep-dive", label: "Deep Dive", icon: SearchIcon },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function labelForSegment(segment: string, instances: Instance[]): string {
  if (!segment) return "Home";
  const inst = instances.find((i) => i.id === segment);
  if (inst) return inst.name;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function Breadcrumbs({ instances }: { instances: Instance[] }) {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: { to: string; label: string }[] = [
    { to: "/", label: "Dashboard" },
  ];
  if (segments.length === 0) {
    crumbs.push({ to: "/", label: "Home" });
  } else {
    let acc = "";
    segments.forEach((seg) => {
      acc += "/" + seg;
      crumbs.push({ to: acc, label: labelForSegment(seg, instances) });
    });
  }

  return (
    <nav className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <div key={`${i}-${c.to}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
            {last ? (
              <span className="truncate font-medium text-foreground">{c.label}</span>
            ) : (
              <Link
                to={c.to}
                className="truncate text-muted-foreground hover:text-foreground"
              >
                {c.label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function AppTopbar() {
  const location = useLocation();
  const [dark, setDark] = useState(() => getCurrentWasupTheme() === "dark");
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const { instances, provisioningActive } = useWorkspaceState();
  const searchRef = useRef<HTMLInputElement>(null);
  const { toggle } = useSidebar();
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadNotifications = () => {
      listNotifications()
        .then((payload) => {
          if (cancelled) return;
          setNotifications(payload.notifications);
          setUnreadCount(payload.unreadCount);
        })
        .catch(() => {
          if (cancelled) return;
          setNotifications([]);
          setUnreadCount(0);
        });
    };

    loadNotifications();
    const interval = window.setInterval(loadNotifications, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme = dark ? "light" : "dark";
    persistWasupTheme(nextTheme);
    setDark(nextTheme === "dark");
  };

  const markAllRead = () => {
    setNotifications((items) => items.map((item) => item.readAt ? item : { ...item, readAt: new Date().toISOString() }));
    setUnreadCount(0);
    void markNotificationsRead({ all: true });
  };

  const markRead = (id: string) => {
    const wasUnread = notifications.some((item) => item.id === id && !item.readAt);
    setNotifications((items) => items.map((item) => item.id === id ? { ...item, readAt: item.readAt || new Date().toISOString() } : item));
    if (wasUnread) setUnreadCount((count) => Math.max(0, count - 1));
    void markNotificationsRead({ ids: [id] });
  };

  return (
    <div className="relative border-b border-border/60 bg-background">
      <header className="flex h-14 items-center justify-between gap-3 px-4 sm:h-16 md:px-6">
      <div className="flex min-w-0 items-center gap-3 md:gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle sidebar"
          className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 md:inline-flex"
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>
        <Breadcrumbs instances={instances} />
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div className="relative hidden lg:block">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder={provisioningActive ? "Search available when ready" : "Search"}
            disabled={provisioningActive}
            className="h-9 w-64 rounded-lg bg-muted/60 pl-9 pr-16 text-sm outline-none placeholder:text-muted-foreground/70 focus:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded border border-border/60 bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {isMac ? "⌘" : "Ctrl"}
            <span>/</span>
          </kbd>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="rounded-md p-2 text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95"
        >
          {dark ? (
            <MoonIcon className="h-4 w-4 animate-scale-in" />
          ) : (
            <SunIcon className="h-4 w-4 animate-scale-in" />
          )}
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setAlertsOpen((o) => !o)}
            aria-label="Notifications"
            className="relative rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <BellIcon className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {alertsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAlertsOpen(false)}
              />
              <div className="fixed left-3 right-3 top-16 z-50 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg animate-pop-in sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="text-sm font-semibold">Notifications</div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No notifications
                    </div>
                  ) : (
                    notifications.map((a) => {
                      const Icon =
                        a.level === "warn"
                          ? AlertTriangleIcon
                          : a.level === "success"
                          ? CheckCircle2Icon
                          : InfoIcon;
                      const color =
                        a.level === "warn"
                          ? "text-amber-600"
                          : a.level === "success"
                          ? "text-emerald-600"
                          : "text-sky-600";
                      return (
                        <button
                          key={a.id}
                          onClick={() => markRead(a.id)}
                          className={cn(
                            "flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left last:border-0 hover:bg-muted/50",
                            a.readAt && "opacity-70",
                          )}
                        >
                          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {!a.readAt && <span className="h-1.5 w-1.5 rounded-full bg-destructive" />}
                              <div className="text-sm font-medium">{a.title}</div>
                            </div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {a.body}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              {a.kind && (
                                <span className="rounded-full bg-muted px-1.5 py-0.5">
                                  {a.kind}
                                </span>
                              )}
                              <span>{formatNotificationTime(a.createdAt)}</span>
                              {a.readAt && <span>Read</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      </header>
      <nav className="flex gap-2 overflow-x-auto px-3 pb-3 md:hidden">
        {MOBILE_NAV.map((item) => {
          const Icon = item.icon;
          const active = item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={(event) => {
                if (provisioningActive && item.to !== "/connection") event.preventDefault();
              }}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                active
                  ? "border-border bg-foreground text-background"
                  : "border-border/60 bg-muted/35 text-muted-foreground",
                provisioningActive && item.to !== "/connection" && "pointer-events-none opacity-45",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function formatNotificationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
