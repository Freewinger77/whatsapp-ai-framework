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
} from "lucide-react";
import { useSidebar } from "@/polymet/hooks/use-sidebar";
import { INSTANCES } from "@/polymet/data/dashboard-data";
import { cn } from "@/lib/utils";

type Alert = {
  id: string;
  title: string;
  body: string;
  time: string;
  level: "info" | "warn" | "success";
};

const INITIAL_ALERTS: Alert[] = [
  {
    id: "1",
    title: "Webhook failure on Wasup 1",
    body: "Server responded with 500 at 13:42",
    time: "2m ago",
    level: "warn",
  },
  {
    id: "2",
    title: "Dev key rotated",
    body: "Your dev key was rotated successfully.",
    time: "1h ago",
    level: "success",
  },
  {
    id: "3",
    title: "New region available",
    body: "Germany is now available for new instances.",
    time: "Yesterday",
    level: "info",
  },
];

function labelForSegment(segment: string): string {
  if (!segment) return "Home";
  const inst = INSTANCES.find((i) => i.id === segment);
  if (inst) return inst.name;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function Breadcrumbs() {
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
      crumbs.push({ to: acc, label: labelForSegment(seg) });
    });
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <div key={`${i}-${c.to}`} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground/60" />
            )}
            {last ? (
              <span className="font-medium text-foreground">{c.label}</span>
            ) : (
              <Link
                to={c.to}
                className="text-muted-foreground hover:text-foreground"
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
  const [dark, setDark] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>(INITIAL_ALERTS);
  const [alertsOpen, setAlertsOpen] = useState(false);
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

  const toggleTheme = () => {
    const root = document.documentElement;
    root.classList.toggle("dark");
    setDark(root.classList.contains("dark"));
  };

  const clearAll = () => setAlerts([]);
  const dismiss = (id: string) =>
    setAlerts((a) => a.filter((x) => x.id !== id));

  return (
    <header className="relative flex h-16 items-center justify-between border-b border-border/60 bg-background px-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label="Toggle sidebar"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
        >
          <PanelLeftIcon className="h-4 w-4" />
        </button>
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Captain"
            className="h-9 w-64 rounded-full bg-muted/60 pl-9 pr-16 text-sm outline-none placeholder:text-muted-foreground/70 focus:bg-muted"
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
            {alerts.length > 0 && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
          </button>

          {alertsOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setAlertsOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-lg animate-pop-in">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                  <div className="text-sm font-semibold">Notifications</div>
                  {alerts.length > 0 && (
                    <button
                      onClick={clearAll}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Clear all
                    </button>
                  )}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {alerts.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      No alerts
                    </div>
                  ) : (
                    alerts.map((a) => {
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
                          onClick={() => dismiss(a.id)}
                          className="flex w-full items-start gap-3 border-b border-border/40 px-4 py-3 text-left last:border-0 hover:bg-muted/50"
                        >
                          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">{a.title}</div>
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">
                              {a.body}
                            </div>
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
                              {a.time}
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
  );
}
