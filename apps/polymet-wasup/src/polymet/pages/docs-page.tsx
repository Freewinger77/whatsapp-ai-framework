import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpenIcon, ExternalLinkIcon, FileCodeIcon, Gamepad2Icon } from "lucide-react";
import { getConnection } from "@/polymet/lib/control-plane-api";
import { getWorkerBaseUrl, getWorkerLinks, isWorkerReady } from "@/polymet/lib/worker-links";

type DocsLinkState = {
  baseUrl: string;
  status: string;
  progressMessage: string;
  ready: boolean;
  loading: boolean;
  docsUrl: string;
  playgroundUrl: string;
  openApiUrl: string;
};

const LINK_CARDS = [
  {
    key: "docs",
    icon: BookOpenIcon,
    title: "Worker Docs",
    body: "Open the live API documentation served by this workspace worker.",
  },
  {
    key: "playground",
    icon: Gamepad2Icon,
    title: "Playground",
    body: "Open the in-platform dashboard playground that uses your signed-in session.",
  },
  {
    key: "openapi",
    icon: FileCodeIcon,
    title: "OpenAPI YAML",
    body: "Download the OpenAPI spec with the server URL rewritten for this deployment.",
  },
] as const;

export function DocsPage() {
  const [links, setLinks] = useState<DocsLinkState>({
    baseUrl: "",
    status: "loading",
    progressMessage: "",
    ready: false,
    loading: true,
    docsUrl: "",
    playgroundUrl: "",
    openApiUrl: "",
  });

  useEffect(() => {
    let cancelled = false;

    getConnection()
      .then((connection) => {
        if (cancelled) return;

        const baseUrl = getWorkerBaseUrl(connection);
        setLinks({
          baseUrl,
          status: connection.deployment.status,
          progressMessage: connection.deployment.progress?.message || connection.deployment.progress?.label || "",
          ready: isWorkerReady(connection),
          loading: false,
          ...getWorkerLinks(baseUrl),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setLinks({
            baseUrl: "",
            status: "unavailable",
            progressMessage: "Could not load workspace connection details.",
            ready: false,
            loading: false,
            docsUrl: "",
            playgroundUrl: "",
            openApiUrl: "",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const waitingCopy = links.loading
    ? "Checking workspace readiness..."
    : links.progressMessage || "Available when workspace is ready.";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Docs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Workspace-specific docs and tools for your provisioned worker.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LINK_CARDS.map((card) => {
          const Icon = card.icon;
          const isPlayground = card.key === "playground";
          const href =
            card.key === "docs"
              ? links.docsUrl
              : card.key === "playground"
                ? "/playground"
                : links.openApiUrl;
          const enabled = isPlayground || links.ready;
          const content = (
            <>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className="h-4 w-4" />
                </span>
                {enabled ? (
                  <ExternalLinkIcon className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    Waiting
                  </span>
                )}
              </div>
              <div className="text-base font-semibold">{card.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {enabled ? card.body : waitingCopy}
              </div>
            </>
          );

          if (isPlayground) {
            return (
              <Link
                key={card.key}
                to={href}
                className="group rounded-xl border border-border/60 bg-card p-5 text-left transition-colors hover:bg-muted/40"
              >
                {content}
              </Link>
            );
          }

          return (
            <a
              key={card.key}
              href={enabled ? href : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!enabled}
              className="group rounded-xl border border-border/60 bg-card p-5 text-left transition-colors hover:bg-muted/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-card"
            >
              {content}
            </a>
          );
        })}
      </div>
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        {links.baseUrl ? (
          <>
            Worker docs and OpenAPI open against this worker base URL:{" "}
            <span className="font-mono text-foreground">{links.baseUrl}</span>
            <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[10px] uppercase tracking-wider">
              {links.status}
            </span>
          </>
        ) : (
          "Docs and Playground will be available once this workspace has a provisioned worker base URL."
        )}
      </div>
    </div>
  );
}
