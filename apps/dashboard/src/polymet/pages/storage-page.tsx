import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  MusicIcon,
  RefreshCwIcon,
  VideoIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import {
  fetchInstanceMediaBlob,
  listInstanceMedia,
  type InstanceMediaItem,
} from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const TYPE_FILTERS = [
  { value: "", label: "All types" },
  { value: "image", label: "Images" },
  { value: "video", label: "Video" },
  { value: "audio", label: "Audio" },
  { value: "document", label: "Documents" },
] as const;

function formatBytes(size?: number) {
  if (!size) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(value?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function mediaIcon(mimeType?: string | null, mediaType?: string) {
  const type = (mimeType || mediaType || "").toLowerCase();
  if (type.includes("image")) return ImageIcon;
  if (type.includes("video")) return VideoIcon;
  if (type.includes("audio")) return MusicIcon;
  return FileIcon;
}

function isImageMime(mimeType?: string | null) {
  return Boolean(mimeType?.startsWith("image/"));
}

function MediaPreview({
  instanceId,
  item,
}: {
  instanceId: string;
  item: InstanceMediaItem;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImageMime(item.mimeType) || item.publicUrl) return;

    let cancelled = false;
    let objectUrl = "";

    fetchInstanceMediaBlob(instanceId, item.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [instanceId, item.id, item.mimeType, item.publicUrl]);

  const previewSrc = item.publicUrl || blobUrl;
  const Icon = mediaIcon(item.mimeType, item.mediaType);

  if (previewSrc && !failed) {
    return (
      <img
        src={previewSrc}
        alt={item.fileName || item.id}
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/40 text-muted-foreground">
      <Icon className="h-8 w-8" />
    </div>
  );
}

export function StoragePage() {
  const { instances, loading: workspaceLoading } = useWorkspaceState();
  const [instanceId, setInstanceId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [items, setItems] = useState<InstanceMediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const selectableInstances = useMemo(
    () => instances.filter((item) => item.provisioningState !== "provisioning"),
    [instances],
  );

  useEffect(() => {
    if (instanceId || selectableInstances.length === 0) return;
    setInstanceId(selectableInstances[0].id);
  }, [instanceId, selectableInstances]);

  const loadMedia = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    setError("");
    try {
      const result = await listInstanceMedia(instanceId, {
        type: typeFilter || undefined,
        limit: 100,
      });
      setItems(result.media || []);
    } catch (loadError) {
      setItems([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load media");
    } finally {
      setLoading(false);
    }
  }, [instanceId, typeFilter]);

  useEffect(() => {
    void loadMedia();
  }, [loadMedia]);

  const downloadMedia = async (item: InstanceMediaItem) => {
    if (!instanceId) return;
    try {
      const blob = await fetchInstanceMediaBlob(instanceId, item.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.fileName || `${item.id}.bin`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Download started", { description: item.fileName || item.id });
    } catch (downloadError) {
      toast.error("Download failed", {
        description: downloadError instanceof Error ? downloadError.message : "Could not fetch file",
      });
    }
  };

  const openMedia = async (item: InstanceMediaItem) => {
    if (item.publicUrl) {
      window.open(item.publicUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (!instanceId) return;
    try {
      const blob = await fetchInstanceMediaBlob(instanceId, item.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (openError) {
      toast.error("Could not open file", {
        description: openError instanceof Error ? openError.message : "Fetch failed",
      });
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Storage</h1>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Browse media saved on your worker — inbound attachments and outbound uploads.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadMedia()}
          disabled={!instanceId || loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border/70 px-4 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCwIcon className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium text-muted-foreground">Instance</span>
          <select
            value={instanceId}
            onChange={(event) => setInstanceId(event.target.value)}
            disabled={workspaceLoading || selectableInstances.length === 0}
            className="h-10 rounded-lg border border-border/60 bg-background px-3 outline-none focus:ring-2 focus:ring-ring/30"
          >
            {selectableInstances.length === 0 ? (
              <option value="">No instances yet</option>
            ) : (
              selectableInstances.map((instance) => (
                <option key={instance.id} value={instance.id}>
                  {instance.name} ({instance.phone || instance.id})
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex w-full flex-col gap-1.5 text-sm sm:w-48">
          <span className="font-medium text-muted-foreground">Type</span>
          <select
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
            className="h-10 rounded-lg border border-border/60 bg-background px-3 outline-none focus:ring-2 focus:ring-ring/30"
          >
            {TYPE_FILTERS.map((filter) => (
              <option key={filter.value || "all"} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2 p-4">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-16 text-center">
          <FileIcon className="mx-auto h-10 w-10 text-muted-foreground/70" />
          <p className="mt-4 text-base font-medium">No media files yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Files appear here when customers send attachments or you send media through the API.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <article
              key={item.id}
              className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm transition hover:border-border"
            >
              <button
                type="button"
                onClick={() => void openMedia(item)}
                className="block aspect-[4/3] w-full overflow-hidden bg-muted/30"
              >
                <MediaPreview instanceId={instanceId} item={item} />
              </button>
              <div className="space-y-2 p-4">
                <div className="truncate text-sm font-medium">{item.fileName || item.id}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="rounded-full bg-muted px-2 py-0.5 capitalize">{item.direction || "unknown"}</span>
                  <span>{formatBytes(item.size)}</span>
                  <span>{formatWhen(item.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void downloadMedia(item)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs font-medium hover:bg-muted"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    Download
                  </button>
                  {item.publicUrl && (
                    <a
                      href={item.publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs font-medium hover:bg-muted"
                    >
                      <ExternalLinkIcon className="h-3.5 w-3.5" />
                      Blob
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
