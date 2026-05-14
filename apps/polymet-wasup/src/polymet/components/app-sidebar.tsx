import { Link, useLocation } from "react-router-dom";
import {
  NewspaperIcon,
  BoxIcon,
  TerminalIcon,
  SearchIcon,
  BookOpenIcon,
  ExternalLinkIcon,
  SettingsIcon,
  LogOutIcon,
} from "lucide-react";
import { USER, INSTANCES } from "@/polymet/data/dashboard-data";
import { instanceGradient } from "@/polymet/data/instance-colors";
import { useSidebar } from "@/polymet/hooks/use-sidebar";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: NewspaperIcon },
  { to: "/instances", label: "Instances", icon: BoxIcon },
  { to: "/connection", label: "Connection", icon: TerminalIcon },
  { to: "/deep-dive", label: "Deep Dive", icon: SearchIcon },
];

export function AppSidebar() {
  const { pathname } = useLocation();
  const { collapsed } = useSidebar();

  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname.startsWith(to);

  const onInstances = pathname.startsWith("/instances");

  return (
    <aside
      className={cn(
        "flex h-screen shrink-0 flex-col overflow-hidden border-r border-border/60 bg-background transition-[width,padding,opacity,transform] duration-300 ease-out",
        collapsed
          ? "w-16 translate-x-0 px-3 py-6 opacity-100"
          : "w-60 translate-x-0 px-4 py-6 opacity-100"
      )}
    >
      <div className={cn("pb-8", collapsed ? "px-0 text-center" : "px-2")}>
        <Link to="/" className="font-mono text-sm tracking-tight text-foreground" aria-label="Wasup home">
          {collapsed ? "<>" : "<wasup.co/>"}
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.to);
          return (
            <div key={item.to}>
              <Link
                to={item.to}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                  collapsed && "justify-center gap-0 px-0",
                  active
                    ? "bg-muted text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5"
                )}
              >
                <Icon
                  className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
                  fill="none"
                  strokeWidth={2}
                />
                {!collapsed && <span>{item.label}</span>}
              </Link>

              {item.to === "/instances" && onInstances && !collapsed && (
                <div className="mt-1 ml-3 space-y-0.5 overflow-hidden border-l border-border/60 pl-3 animate-fade-up">
                  {INSTANCES.map((inst) => {
                    const instActive = pathname === `/instances/${inst.id}`;
                    return (
                      <Link
                        key={inst.id}
                        to={`/instances/${inst.id}`}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          instActive
                            ? "bg-muted text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        )}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: instanceGradient(inst.id) }}
                        />
                        <span className="truncate">{inst.name}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        <a
          href="https://docs.wasup.co"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={collapsed ? "Docs" : undefined}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-muted/60 hover:text-foreground hover:translate-x-0.5",
            collapsed && "justify-center gap-0 px-0",
          )}
        >
          <BookOpenIcon className="h-4 w-4 transition-transform duration-200 group-hover:scale-110" strokeWidth={2} />
          {!collapsed && (
            <>
              <span className="flex-1">Docs</span>
              <ExternalLinkIcon className="h-3.5 w-3.5 opacity-70 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </>
          )}
        </a>

        <Link
          to="/settings"
          aria-label={collapsed ? "Settings" : undefined}
          className={cn(
            "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200",
            collapsed && "justify-center gap-0 px-0",
            isActive("/settings")
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:translate-x-0.5"
          )}
        >
          <SettingsIcon
            className="h-4 w-4 transition-transform duration-200 group-hover:scale-110"
            fill="none"
            strokeWidth={2}
          />
          {!collapsed && <span>Settings</span>}
        </Link>
      </nav>

      <div className={cn("flex items-center border-t border-border/60 pt-4", collapsed ? "justify-center" : "justify-between gap-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <img
            src={USER.avatar}
            alt={USER.displayName}
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{USER.displayName}</div>
              <div className="truncate text-xs text-muted-foreground">
                {USER.email}
              </div>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            type="button"
            aria-label="Sign out"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOutIcon className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
