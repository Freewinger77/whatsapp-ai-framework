import { useState } from "react";
import { createPortal } from "react-dom";
import {
  LockIcon,
  CopyIcon,
  CheckIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
} from "lucide-react";
import { API_KEYS, ApiKey } from "@/polymet/data/dashboard-data";
import { cn } from "@/lib/utils";

function randomKey() {
  const seg = () =>
    Math.random().toString(36).slice(2, 6).toUpperCase();
  return `dev-wa-${seg().toLowerCase()}****-*******-*****`;
}

function IconButton({
  label,
  tooltip,
  onClick,
  children,
  className,
}: {
  label: string;
  tooltip?: string;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className
        )}
      >
        {children}
      </button>
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow transition-opacity group-hover:opacity-100">
          {tooltip}
        </div>
      )}
    </div>
  );
}

function KeyRow({ keyData }: { keyData: ApiKey }) {
  const [masked, setMasked] = useState(keyData.masked);
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const doCopy = async () => {
    try {
      await navigator.clipboard?.writeText(masked);
    } catch {
      /* ignore */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 7000);
  };

  const doRotate = () => {
    setConfirmOpen(false);
    setRotating(true);
    setTimeout(() => {
      setMasked(randomKey());
      setRotating(false);
    }, 1600);
  };

  return (
    <div>
      <div className="mb-3">
        <div className="text-base font-semibold">{keyData.label}</div>
        <div className="text-sm text-muted-foreground">{keyData.expires}</div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex flex-1 items-center gap-2 rounded-full bg-muted/60 px-4 py-2.5 font-mono text-sm max-w-md transition-opacity",
            rotating && "opacity-60"
          )}
        >
          <LockIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{masked}</span>
        </div>

        <div className="group relative">
          <button
            type="button"
            onClick={doCopy}
            aria-label={copied ? "Copied" : "Copy"}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <CheckIcon className="h-4 w-4 text-emerald-600" />
            ) : (
              <CopyIcon className="h-4 w-4" />
            )}
          </button>
          <div className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-[10px] font-medium text-background opacity-0 shadow transition-opacity group-hover:opacity-100">
            {copied ? "Copied!" : "Copy"}
          </div>
        </div>

        <IconButton
          label="Rotate key"
          tooltip="Rotate"
          onClick={() => setConfirmOpen(true)}
        >
          <RefreshCwIcon
            className={cn("h-4 w-4", rotating && "animate-spin text-foreground")}
          />
        </IconButton>
      </div>

      {confirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setConfirmOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-border bg-background p-6 shadow-2xl animate-pop-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40">
                <AlertTriangleIcon className="h-5 w-5" />
              </div>
              <div className="text-base font-semibold">Rotate {keyData.label}?</div>
              <p className="mt-1 text-sm text-muted-foreground">
                This action will rotate your key. The old key will stop working
                immediately.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="h-9 rounded-md border border-border px-3 text-sm hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={doRotate}
                  className="h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90"
                >
                  Yes, rotate
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function DownloadTile({ title }: { title: string }) {
  return (
    <button
      type="button"
      className="group flex h-28 w-32 flex-col justify-between rounded-xl border border-border/60 bg-card p-4 text-left transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-muted/50 hover:shadow-md"
    >
      <div className="text-sm font-semibold leading-tight whitespace-pre-line">
        {title}
      </div>
      <CopyIcon className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:scale-110" />
    </button>
  );
}

export function ConnectionPage() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Connection</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Rotate your instance API credentials
        </p>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto]">
        <div className="space-y-10">
          {API_KEYS.map((k) => (
            <KeyRow key={k.id} keyData={k} />
          ))}
        </div>
        <div className="flex gap-4 self-end">
          <DownloadTile title={"MCP\nJSON"} />
          <DownloadTile title={"API\nSPEC"} />
        </div>
      </div>
    </div>
  );
}
