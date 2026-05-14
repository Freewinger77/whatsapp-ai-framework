import { BookOpenIcon, ZapIcon, KeyRoundIcon, TerminalIcon } from "lucide-react";

const SECTIONS = [
  {
    icon: ZapIcon,
    title: "Quickstart",
    body: "Spin up your first Wasup instance in under 2 minutes.",
  },
  {
    icon: KeyRoundIcon,
    title: "Authentication",
    body: "Use your production and dev API keys to authorize requests.",
  },
  {
    icon: TerminalIcon,
    title: "API Reference",
    body: "Complete reference for every endpoint and response shape.",
  },
  {
    icon: BookOpenIcon,
    title: "Guides",
    body: "Patterns, best practices and integration walkthroughs.",
  },
];

export function DocsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you need to build on Wasup
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.title}
              type="button"
              className="group rounded-xl border border-border/60 bg-card p-5 text-left transition-colors hover:bg-muted/40"
            >
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Icon className="h-4 w-4" />
              </div>
              <div className="text-base font-semibold">{s.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{s.body}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
