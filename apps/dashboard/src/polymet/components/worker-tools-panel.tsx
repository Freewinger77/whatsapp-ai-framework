import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpenIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  Gamepad2Icon,
  LayoutDashboardIcon,
  FileCodeIcon,
  TerminalIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WORKER_CAPABILITIES, getWorkerLinks } from "@/polymet/lib/worker-links";

type WorkerLinkSet = ReturnType<typeof getWorkerLinks>;

const TOOL_CARDS = [
  {
    key: "playground",
    title: "Test console",
    description: "Send text, buttons, CTA links, and reactions — same UI as wasup-dev and wasup2.",
    icon: Gamepad2Icon,
    hrefKey: "playgroundUrl" as const,
    primary: true,
  },
  {
    key: "docs",
    title: "API docs",
    description: "Scalar reference for send, connect, webhooks, and media on your org worker.",
    icon: BookOpenIcon,
    hrefKey: "docsUrl" as const,
  },
  {
    key: "openapi",
    title: "OpenAPI YAML",
    description: "Download the worker spec with your org URL as the server base.",
    icon: FileCodeIcon,
    hrefKey: "openApiUrl" as const,
  },
  {
    key: "control-plane-docs",
    title: "Dashboard API (v3)",
    description: "Control plane reference for GET /me, instances, billing, Deep Dive, and provisioning — includes GET /api/v3/me.",
    icon: BookOpenIcon,
    hrefKey: "controlPlaneDocsUrl" as const,
    alwaysEnabled: true,
  },
  {
    key: "admin",
    title: "Worker admin",
    description: "Multi-instance dashboard, QR pairing, and live logs on the worker VM.",
    icon: LayoutDashboardIcon,
    hrefKey: "adminUrl" as const,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  title: string;
  description: string;
  icon: typeof Gamepad2Icon;
  hrefKey: keyof ReturnType<typeof getWorkerLinks>;
  primary?: boolean;
  alwaysEnabled?: boolean;
}>;

export function WorkerToolsPanel({
  links,
  ready,
  loading,
  status,
  progressMessage,
  title,
  subtitle,
}: {
  links: WorkerLinkSet;
  ready: boolean;
  loading: boolean;
  status: string;
  progressMessage: string;
  title: string;
  subtitle: string;
}) {
  const [copied, setCopied] = useState(false);
  const waitingCopy = loading
    ? "Checking workspace readiness..."
    : progressMessage || "Available when your worker finishes provisioning.";

  const copyBaseUrl = async () => {
    if (!links.baseUrl) return;
    try {
      await navigator.clipboard?.writeText(links.baseUrl);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">{subtitle}</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="border-b border-border/60 px-5 py-4">
          <div className="text-sm font-medium text-muted-foreground">Your worker URL</div>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 rounded-xl bg-muted/50 px-4 py-3 font-mono text-sm sm:text-base">
              {links.baseUrl || "https://your-workspace.wasup.co"}
            </div>
            <button
              type="button"
              onClick={copyBaseUrl}
              disabled={!links.baseUrl}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border/70 px-4 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <CopyIcon className="h-4 w-4" />}
              {copied ? "Copied" : "Copy URL"}
            </button>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Every provisioned workspace gets its own subdomain on{" "}
            <span className="font-mono text-foreground/90">wasup.co</span>. Docs and the test console use this URL automatically.
          </p>
          {!ready && (
            <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{waitingCopy}</p>
          )}
        </div>

        <div className="grid gap-px bg-border/60 sm:grid-cols-2">
          {TOOL_CARDS.map((card) => {
            const Icon = card.icon;
            const href = links[card.hrefKey];
            const enabled = (card.alwaysEnabled || ready) && Boolean(href);

            return (
              <a
                key={card.key}
                href={enabled ? href : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!enabled}
                className={cn(
                  "group flex min-h-[168px] flex-col justify-between bg-card p-5 transition hover:bg-muted/30",
                  card.primary && enabled && "sm:col-span-2 sm:flex-row sm:items-center sm:gap-6",
                  !enabled && "cursor-not-allowed opacity-60 hover:bg-card",
                )}
              >
                <div className={cn("min-w-0", card.primary && enabled && "sm:flex-1")}>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                      <Icon className="h-5 w-5" />
                    </span>
                    {enabled ? (
                      <ExternalLinkIcon className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                    ) : (
                      <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium capitalize text-muted-foreground">
                        {status.replace(/_/g, " ")}
                      </span>
                    )}
                  </div>
                  <div className="text-lg font-semibold">{card.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{card.description}</p>
                  {enabled && href && (
                    <p className="mt-3 truncate font-mono text-xs text-foreground/70">{href}</p>
                  )}
                </div>
                {card.primary && enabled && (
                  <span className="mt-4 inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background sm:mt-0">
                    Open test console
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-2xl border border-border/60 bg-muted/20 p-5">
          <h2 className="text-base font-semibold">Same capabilities as wasup-dev and wasup2</h2>
          <ul className="mt-4 space-y-2">
            {WORKER_CAPABILITIES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TerminalIcon className="h-4 w-4" />
            Before you test
          </div>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>1. Copy your Production or Development key from Connection.</li>
            <li>2. Open the test console on your worker URL.</li>
            <li>3. Paste the key into the API key field — it saves in this browser.</li>
          </ol>
          <Link
            to="/connection"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-border/70 px-4 text-sm font-medium transition hover:bg-muted"
          >
            Go to Connection
          </Link>
        </div>
      </section>
    </div>
  );
}
