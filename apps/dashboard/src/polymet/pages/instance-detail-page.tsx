import type { ComponentType, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ActivityIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  HandIcon,
  KeyRoundIcon,
  LinkIcon,
  MessageCircleIcon,
  PencilIcon,
  QrCodeIcon,
  SaveIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UserRoundIcon,
  WebhookIcon,
  XIcon,
} from "lucide-react";
import {
  BEHAVIOR_OPTIONS,
  INSTANCES,
  type ActivityLogItem,
  type Instance,
  type LiveFeedItem,
} from "@/polymet/data/dashboard-data";
import { instanceGradient } from "@/polymet/data/instance-colors";
import { InlineProvisioningSpinner, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import { InstanceDetailSkeleton } from "@/polymet/components/page-skeletons";
import { clearInstanceAuth, connectInstance, deleteInstance, getDeepDive, getInstance, getInstanceQr, updateInstanceSettings } from "@/polymet/lib/control-plane-api";
import { cn } from "@/lib/utils";

type ConnectMode = "menu" | "qr" | "pairing" | "clear";
type MainSettingsCard = "webhook" | "api-credentials" | "handoff" | "profile" | "behaviour" | "anti-ban" | "proxy";

const DEFAULT_HANDOFF_NUMBERS: string[] = [];
const QR_DISPLAY_TTL_MS = 110_000;
const DEFAULT_OPEN_SETTINGS_CARDS: Record<MainSettingsCard, boolean> = {
  webhook: true,
  "api-credentials": true,
  handoff: false,
  profile: false,
  behaviour: false,
  "anti-ban": false,
  proxy: false,
};

function getQrExpiresInMs(updatedAt?: string | null, workerExpiresInMs?: number | null) {
  if (typeof workerExpiresInMs === "number") return workerExpiresInMs;
  if (!updatedAt) return null;
  return Math.max(0, QR_DISPLAY_TTL_MS - (Date.now() - new Date(updatedAt).getTime()));
}

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { refresh } = useWorkspaceState();
  const [liveInstance, setLiveInstance] = useState<Instance | null>(null);
  const [instanceLoading, setInstanceLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const inst =
    liveInstance ??
    INSTANCES.find((i) => i.id === id) ?? {
      id: id ?? "",
      name: "Instance",
      region: "Pending",
      status: "provisioning" as const,
      phone: "Not linked",
      webhookUrl: "",
      behaviorProfile: "Notification balanced" as const,
      proxy: "pending",
      messagesToday: "0",
      uptime: "Pending",
      qualityScore: "Pending",
    };

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [instanceName, setInstanceName] = useState(inst.name);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(inst.name);
  const [webhookUrl, setWebhookUrl] = useState(inst.webhookUrl);
  const [signingSecret, setSigningSecret] = useState("");
  const [signingSecretEdited, setSigningSecretEdited] = useState(false);
  const [handoffMessage, setHandoffMessage] = useState(
    "Great, I'll take over the chat now. Happy to help!",
  );
  const [resumeKeywords, setResumeKeywords] = useState(["#resume", "#continue", "#bot-on"]);
  const [handoffNumbers, setHandoffNumbers] = useState(DEFAULT_HANDOFF_NUMBERS);
  const [handoffManagerOpen, setHandoffManagerOpen] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState(inst.name);
  const [profileAbout, setProfileAbout] = useState("");
  const [profilePictureUrl, setProfilePictureUrl] = useState(
    "",
  );
  const [pictureStatus, setPictureStatus] = useState("No profile picture set");
  const [pictureModalOpen, setPictureModalOpen] = useState(false);
  const [notificationGrace, setNotificationGrace] = useState(
    inst.behaviorProfile === "Bot-native" ? "0" : "8",
  );
  const [behaviorProfile, setBehaviorProfile] = useState(inst.behaviorProfile);
  const [connected, setConnected] = useState(inst.status === "active");
  const [linkOpen, setLinkOpen] = useState(false);
  const [typing, setTyping] = useState(inst.behaviorProfile !== "Notification max");
  const [readReceipts, setReadReceipts] = useState(inst.behaviorProfile !== "Notification max");
  const [responseDelays, setResponseDelays] = useState(false);
  const [handoffsCleared, setHandoffsCleared] = useState(false);
  const [pictureRemoved, setPictureRemoved] = useState(false);
  const [openSettingsCards, setOpenSettingsCards] = useState<Record<MainSettingsCard, boolean>>(
    DEFAULT_OPEN_SETTINGS_CARDS,
  );
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [instanceFeed, setInstanceFeed] = useState<LiveFeedItem[]>([]);
  const [instanceLogs, setInstanceLogs] = useState<ActivityLogItem[]>([]);
  const [activityError, setActivityError] = useState("");

  const statusLabel = inst.status === "provisioning" ? "provisioning" : inst.status === "connecting" ? "connecting" : connected ? "active" : "disconnected";
  const health = getInstanceHealth(connected, inst.status, inst.qualityScore);

  const activityItems = useMemo(
    () =>
      [
        ...instanceFeed.map((item) => ({
          id: `feed-${item.timestamp}-${item.direction}-${item.phone}`,
          type: "feed" as const,
          timestamp: item.timestamp,
          item,
        })),
        ...instanceLogs.map((item) => ({
          id: `log-${item.timestamp}-${item.level}-${item.source.slice(0, 24)}`,
          type: "log" as const,
          timestamp: item.timestamp,
          item,
        })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [instanceFeed, instanceLogs],
  );

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    const loadActivity = () => {
      getDeepDive({ type: "all", instanceId: id })
        .then((activity) => {
          if (cancelled) return;
          setInstanceFeed(
            activity.messages.map((message) => ({
              direction: message.direction === "outbound" ? "Sent" : "Received",
              phone: message.phone || "Unknown",
              text: message.body || "",
              instanceId: message.instance_id || id,
              time: formatActivityTime(message.created_at),
              timestamp: message.created_at,
            })),
          );
          setInstanceLogs(
            activity.logs.map((log) => ({
              source: log.summary || log.event_type,
              level: mapSeverity(log.severity),
              instanceId: log.instance_id || id,
              time: formatActivityTime(log.created_at),
              timestamp: log.created_at,
            })),
          );
          setActivityError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setInstanceFeed([]);
          setInstanceLogs([]);
          setActivityError(error instanceof Error ? error.message : "Could not load live activity");
        });
    };

    loadActivity();
    const timer = window.setInterval(loadActivity, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setInstanceLoading(true);
    const refreshInstance = () => {
      getInstance(id)
        .then((nextInstance) => {
          if (cancelled) return;
          setLiveInstance(nextInstance);
          setLoadError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setLiveInstance(null);
          setLoadError(error instanceof Error ? error.message : "Could not refresh instance status");
        })
        .finally(() => {
          if (!cancelled) setInstanceLoading(false);
        });
    };

    refreshInstance();
    const timer = window.setInterval(refreshInstance, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    setInstanceName(inst.name);
    setTitleDraft(inst.name);
    setWebhookUrl(inst.webhookUrl);
    setSigningSecret("");
    setSigningSecretEdited(false);
    setProfileDisplayName(inst.name);
    setBehaviorProfile(inst.behaviorProfile);
    setConnected(inst.status === "active");
    setTitleEditing(false);
  }, [inst.behaviorProfile, inst.id, inst.name, inst.status, inst.webhookUrl]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!dirty) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]");
      if (!anchor) return;
      if (!window.confirm("You have unsaved instance changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [dirty]);

  const markDirty = () => setDirty(true);
  const toggleSettingsCard = (card: MainSettingsCard) => {
    setOpenSettingsCards((current) => ({
      ...current,
      [card]: !current[card],
    }));
  };

  const saveTitle = () => {
    setInstanceName(titleDraft.trim() || inst.name);
    markDirty();
    setTitleEditing(false);
  };

  const saveSettings = async () => {
    if (!id || saving) return;
    setSaving(true);
    try {
      const input: Parameters<typeof updateInstanceSettings>[1] = {
        name: instanceName.trim() || inst.name,
        webhookUrl: webhookUrl.trim() || null,
      };
      if (signingSecretEdited) input.webhookSigningSecret = signingSecret.trim() || null;

      const updated = await updateInstanceSettings(id, input);
      setLiveInstance(updated);
      setDirty(false);
      setSigningSecret("");
      setSigningSecretEdited(false);
      toast.success("Instance settings saved", {
        description: "Webhook settings and instance name were updated.",
      });
    } catch (error) {
      toast.error("Could not save settings", {
        description: error instanceof Error ? error.message : "Please try again shortly.",
      });
    } finally {
      setSaving(false);
    }
  };

  const disconnect = () => {
    if (
      window.confirm(
        "Disconnect this WhatsApp socket? The instance will stop receiving messages until it is connected again. Saved auth remains unless you clear it.",
      )
    ) {
      setConnected(false);
    }
  };

  const setProfilePicture = () => {
    setPictureModalOpen(true);
  };

  const confirmProfilePicture = (nextUrl: string) => {
    setProfilePictureUrl(nextUrl);
    setPictureRemoved(false);
    setPictureStatus("Picture loaded");
    setPictureModalOpen(false);
    markDirty();
  };

  const removeProfilePicture = () => {
    setProfilePictureUrl("");
    setPictureRemoved(true);
    setPictureStatus("Picture removed");
    markDirty();
  };

  const requestDelete = () => {
    if (deleteBusy) return;
    if (!window.confirm("Are you sure?")) return;
    setDeleteError("");
    setDeleteSheetOpen(true);
  };

  const confirmDelete = async () => {
    if (!id || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await deleteInstance(id);
      setDeleteSheetOpen(false);
      setDirty(false);
      toast.success("Instance deleted", {
        description: "The worker instance was cleaned up and its proxy lease was released.",
      });
      await refresh();
      navigate("/instances");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Instance deletion failed";
      setDeleteError(message);
      toast.error("Instance deletion failed", { description: message });
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {instanceLoading && !liveInstance ? (
        <InstanceDetailSkeleton />
      ) : (
        <>
      {loadError && !liveInstance && (
        <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {loadError}
        </div>
      )}
      {inst.lastError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="font-semibold">Provisioning needs attention</div>
          <p className="mt-1">{inst.lastError}</p>
        </div>
      )}
      {deleteError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <div className="flex items-center gap-2 font-semibold">
            <XIcon className="h-4 w-4" />
            Delete failed
          </div>
          <p className="mt-1 text-red-700/80 dark:text-red-200/80">{deleteError}</p>
        </div>
      )}

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div
          className="h-20 w-20 shrink-0 rounded-2xl shadow-sm"
          style={{ background: instanceGradient(inst.id) }}
        />
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-medium uppercase tracking-wider",
              inst.status === "provisioning" || inst.status === "connecting"
                ? "text-blue-600 dark:text-blue-300"
                : connected
                ? "text-emerald-600"
                : "text-red-600 dark:text-red-400",
            )}
          >
            {inst.status === "provisioning" || inst.status === "connecting" ? (
              <InlineProvisioningSpinner className="h-2.5 w-2.5" />
            ) : (
              <CircleIcon className="h-2 w-2" fill="currentColor" stroke="none" />
            )}
            {statusLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {titleEditing ? (
              <input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveTitle();
                  if (event.key === "Escape") {
                    setTitleDraft(instanceName);
                    setTitleEditing(false);
                  }
                }}
                className="h-11 min-w-0 max-w-full rounded-lg border border-border/60 bg-background px-3 text-2xl font-semibold tracking-tight outline-none focus:ring-2 focus:ring-ring/30 sm:text-3xl"
                autoFocus
              />
            ) : (
              <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{instanceName}</h1>
            )}
            <button
              onClick={
                titleEditing
                  ? saveTitle
                  : () => {
                      setTitleDraft(instanceName);
                      setTitleEditing(true);
                    }
              }
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={titleEditing ? "Save instance name" : "Edit instance name"}
            >
              {titleEditing ? <SaveIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{connected ? inst.phone : "Disconnected"}</span>
            <span>·</span>
            <span>{inst.region}</span>
            <span>·</span>
            <span className={cn("font-medium", health.className)}>{health.label}</span>
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {connected ? (
            <button
              onClick={disconnect}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => setLinkOpen(true)}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              Connect
            </button>
          )}
          <button
            onClick={saveSettings}
            disabled={saving}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-3">
        {[
          { icon: ActivityIcon, label: "Messages today", value: inst.messagesToday },
          { icon: ClockIcon, label: "Uptime", value: connected ? inst.uptime : "Disconnected" },
          { icon: GlobeIcon, label: "Region", value: inst.region },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="flex h-full flex-col rounded-xl border border-border/60 bg-card p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 shrink-0" />
                {stat.label}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <section className="min-h-0">
          <LiveActivityPanel instanceId={inst.id} items={activityItems} error={activityError} />
        </section>

        <section className="flex min-h-0 flex-col gap-4">
          <SettingsAccordionCard
            icon={WebhookIcon}
            title="Webhook"
            open={openSettingsCards.webhook}
            onToggle={() => toggleSettingsCard("webhook")}
          >
            <div className="border-b border-border/60 px-4 py-4 text-sm text-muted-foreground sm:px-5">
              <p>
                Webhook signing is optional. For a secured webhook, set a shared
                signing secret so Wasup can sign outbound webhook deliveries and
                your receiver can verify them. For an unsecured webhook or no API-key
                receiver, leave it blank.
              </p>
            </div>
            <EditableTextRow label="Inbound webhook" value={webhookUrl} onSave={setWebhookUrl} onDirty={markDirty} />
            <EditableTextRow
              label="Webhook signing secret"
              value={signingSecret}
              placeholder="Optional - leave blank for unsigned deliveries"
              onSave={(value) => {
                setSigningSecret(value.trim());
                setSigningSecretEdited(true);
              }}
              onDirty={markDirty}
              monospace
            />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={KeyRoundIcon}
            title="API credentials"
            open={openSettingsCards["api-credentials"]}
            onToggle={() => toggleSettingsCard("api-credentials")}
          >
            <InstanceIdentityCard instanceId={inst.id} />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={HandIcon}
            title="Human handoff"
            open={openSettingsCards.handoff}
            onToggle={() => toggleSettingsCard("handoff")}
          >
            <ResumeKeywordChips
              keywords={resumeKeywords}
              onChange={(keywords) => {
                setResumeKeywords(keywords);
                markDirty();
              }}
            />
            <EditableTextRow label="Resume message" value={handoffMessage} onSave={setHandoffMessage} onDirty={markDirty} />
            <ManageNumbersRow count={handoffNumbers.length} onManage={() => setHandoffManagerOpen(true)} />
            {handoffsCleared && (
              <div className="border-t border-border/60 px-5 py-3 text-sm text-emerald-600 dark:text-emerald-400">
                Active handoffs cleared.
              </div>
            )}
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={UserRoundIcon}
            title="WhatsApp profile"
            open={openSettingsCards.profile}
            onToggle={() => toggleSettingsCard("profile")}
          >
            <EditableTextRow label="Display name" value={profileDisplayName} onSave={setProfileDisplayName} onDirty={markDirty} />
            <EditableTextRow label="About / status text" value={profileAbout} onSave={setProfileAbout} onDirty={markDirty} />
            <ProfilePictureRow onSet={setProfilePicture} onRemove={removeProfilePicture} status={pictureStatus} removed={pictureRemoved} />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={SlidersHorizontalIcon}
            title="Behaviour"
            open={openSettingsCards.behaviour}
            onToggle={() => toggleSettingsCard("behaviour")}
          >
            <SelectRow
              label="Behaviour profile"
              value={behaviorProfile}
              options={BEHAVIOR_OPTIONS}
              onChange={(value) => {
                setBehaviorProfile(value);
                markDirty();
              }}
            />
            <ToggleRow
              label="Typing simulation"
              checked={typing}
              onChange={(value) => {
                setTyping(value);
                markDirty();
              }}
            />
            <ToggleRow
              label="Read receipts"
              checked={readReceipts}
              onChange={(value) => {
                setReadReceipts(value);
                markDirty();
              }}
            />
            <ToggleRow
              label="Response delays"
              checked={responseDelays}
              onChange={(value) => {
                setResponseDelays(value);
                markDirty();
              }}
            />
            <EditableTextRow label="Notification grace (s)" value={notificationGrace} onSave={setNotificationGrace} onDirty={markDirty} monospace />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={BellIcon}
            title="Anti-ban and usage"
            open={openSettingsCards["anti-ban"]}
            onToggle={() => toggleSettingsCard("anti-ban")}
          >
            <StaticRow label="Quality score" value={connected ? inst.qualityScore : "Disconnected"} />
            <StaticRow label="Daily send cap" value="1,000 messages" />
            <StaticRow label="Credits consumed today" value={inst.messagesToday} />
            <StaticRow label="Presence cycling" value="Unavailable between bursts" />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={GlobeIcon}
            title="Proxy and region"
            open={openSettingsCards.proxy}
            onToggle={() => toggleSettingsCard("proxy")}
          >
            <StaticRow label="Region" value={inst.region} />
            <StaticRow label="Proxy allocation" value={inst.proxy} />
            <StaticRow label="Policy" value="Auto: provider first, imported pool fallback" />
          </SettingsAccordionCard>

          <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 dark:border-red-900/60 dark:bg-red-950/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold text-red-900 dark:text-red-100">Danger area</h2>
                <p className="mt-1 max-w-xl text-sm text-red-700/80 dark:text-red-200/75">
                  Delete this instance from the control plane. You will be asked to confirm and type the instance name exactly.
                </p>
              </div>
              <button
                type="button"
                onClick={requestDelete}
                disabled={deleteBusy}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-background px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/80 dark:text-red-200 dark:hover:bg-red-950/40"
              >
                <Trash2Icon className="h-4 w-4" />
                {deleteBusy ? "Deleting..." : "Delete instance"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {linkOpen && (
        <ConnectOverlay
          instanceId={inst.id}
          connected={connected}
          onClose={() => setLinkOpen(false)}
          onConnected={() => {
            setConnected(true);
            setLinkOpen(false);
          }}
        />
      )}
      {handoffManagerOpen && (
        <HandoffNumbersOverlay
          numbers={handoffNumbers}
          handoffsCleared={handoffsCleared}
          onChange={(numbers) => {
            setHandoffNumbers(numbers);
            markDirty();
          }}
          onClearHandoffs={() => {
            setHandoffsCleared(true);
            markDirty();
          }}
          onClose={() => setHandoffManagerOpen(false)}
        />
      )}
      {deleteSheetOpen && (
        <DeleteInstanceSheet
          instanceName={instanceName}
          onClose={() => setDeleteSheetOpen(false)}
          onConfirm={confirmDelete}
          busy={deleteBusy}
          error={deleteError}
        />
      )}
      {pictureModalOpen && (
        <ProfilePictureOverlay
          currentUrl={profilePictureUrl}
          onClose={() => setPictureModalOpen(false)}
          onConfirm={confirmProfilePicture}
        />
      )}
        </>
      )}
    </div>
  );
}

function ManageNumbersRow({ count, onManage }: { count: number; onManage: () => void }) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="text-sm text-muted-foreground">Phone number to tag</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm">{count} tagged</span>
        <button
          onClick={onManage}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          Manage
          <ExternalLinkIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function InstanceIdentityCard({ instanceId }: { instanceId: string }) {
  const [copied, setCopied] = useState(false);

  const copyInstanceId = async () => {
    if (!instanceId || instanceId.includes("...")) {
      toast.error("Nothing safe to copy", {
        description: "The instance ID is not available yet.",
      });
      return;
    }

    try {
      await navigator.clipboard?.writeText(instanceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 7000);
      toast.success("Instance ID copied");
    } catch {
      toast.error("Copy failed", {
        description: "Your browser did not allow clipboard access.",
      });
    }
  };

  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
        <div className="text-sm font-semibold">Instance-scoped identifier</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Use this ID with API requests, support tickets, and webhook routing. Workspace API keys live on the Connection page.
        </p>
      </div>

      <div className="rounded-xl border border-border/60 bg-background p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-semibold">Instance ID</div>
            <p className="mt-1 text-xs text-muted-foreground">
              This copy button always copies the raw ID shown here, never masked text.
            </p>
          </div>
          <span className="inline-flex w-fit rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Instance
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-sm">
            <KeyRoundIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{instanceId}</span>
          </div>
          <button
            type="button"
            onClick={copyInstanceId}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {copied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <CopyIcon className="h-4 w-4" />}
            Copy ID
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfilePictureRow({
  onSet,
  onRemove,
  status,
  removed,
}: {
  onSet: () => void;
  onRemove: () => void;
  status: string;
  removed: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <div className="text-sm text-muted-foreground">Profile picture</div>
        <div className={cn("mt-1 text-sm", removed ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")}>
          {status}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <button
          onClick={onSet}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          <CameraIcon className="h-4 w-4" />
          Set picture
        </button>
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
        >
          <Trash2Icon className="h-4 w-4" />
          Remove
        </button>
      </div>
    </div>
  );
}

function ProfilePictureOverlay({
  currentUrl,
  onClose,
  onConfirm,
}: {
  currentUrl: string;
  onClose: () => void;
  onConfirm: (url: string) => void;
}) {
  const [url, setUrl] = useState(currentUrl || "https://example.com/photo.jpg");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const canSave = /^https?:\/\/.+/i.test(url.trim()) && previewStatus !== "loading";

  const testPreview = () => {
    if (!/^https?:\/\/.+/i.test(url.trim())) {
      setPreviewStatus("error");
      return;
    }
    setPreviewStatus("loading");
    window.setTimeout(() => setPreviewStatus("loaded"), 650);
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl animate-pop-in sm:rounded-3xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Set profile picture</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste an image URL. In production this will validate and push the picture to WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close profile picture modal"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-medium">Picture URL</span>
          <input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setPreviewStatus("idle");
            }}
            placeholder="https://example.com/photo.jpg"
            className="h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/30"
            autoFocus
          />
        </label>

        <div className="mt-5 flex items-center gap-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-background">
            {previewStatus === "loaded" ? (
              <img src={url} alt="Profile preview" className="h-full w-full object-cover" />
            ) : (
              <CameraIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-semibold">
              {previewStatus === "loading" && "Checking image..."}
              {previewStatus === "loaded" && "Picture ready"}
              {previewStatus === "error" && "Enter a valid image URL"}
              {previewStatus === "idle" && "Preview before saving"}
            </div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{url}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={testPreview}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Preview
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onConfirm(url.trim())}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Set picture
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function StaticRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="max-w-full truncate font-mono text-sm sm:max-w-[60%] sm:text-right">{value}</div>
    </div>
  );
}

function ResumeKeywordChips({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addKeyword = () => {
    const normalized = normalizeKeyword(draft);
    if (!normalized || keywords.includes(normalized)) return;
    onChange([...keywords, normalized]);
    setDraft("");
  };

  const removeKeyword = (keyword: string) => {
    onChange(keywords.filter((item) => item !== keyword));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addKeyword();
  };

  return (
    <div className="border-b border-border/60 px-4 py-4 sm:px-5">
      <div className="mb-3 text-sm text-muted-foreground">Resume keywords</div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background p-2">
        {keywords.map((keyword) => (
          <span
            key={keyword}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 font-mono text-xs font-medium"
          >
            {keyword}
            <button
              type="button"
              onClick={() => removeKeyword(keyword)}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
              aria-label={`Remove ${keyword}`}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) addKeyword();
          }}
          placeholder="#resume"
          className="h-8 min-w-32 flex-1 bg-transparent px-1 text-sm outline-none"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Type a hashtag or word and press Enter to add it.</p>
    </div>
  );
}

function EditableTextRow({
  label,
  value,
  onSave,
  onDirty,
  monospace = false,
  placeholder = "",
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  onDirty: () => void;
  monospace?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const save = () => {
    onSave(draft);
    onDirty();
    setEditing(false);
  };

  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex min-w-0 flex-1 justify-end gap-2">
        {editing ? (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            className={cn(
              "h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-left text-sm outline-none focus:ring-2 focus:ring-ring/30 sm:text-right md:max-w-[420px]",
              monospace && "font-mono",
            )}
          />
        ) : (
          <div
            className={cn(
              "min-w-0 flex-1 truncate text-left text-sm sm:text-right md:max-w-[420px]",
              monospace ? "font-mono" : "font-medium",
            )}
          >
            {value || <span className="text-muted-foreground/70">{placeholder || "Not set"}</span>}
          </div>
        )}
        <button
          onClick={editing ? save : () => setEditing(true)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
          aria-label={editing ? `Save ${label}` : `Edit ${label}`}
        >
          {editing ? <SaveIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function SelectRow<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: readonly TValue[];
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30 sm:w-auto"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border/60 px-4 py-4 last:border-b-0 sm:px-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
          checked ? "border-foreground bg-foreground" : "border-border bg-muted",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-[22px]" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}

function LiveActivityPanel({
  instanceId,
  items,
  error,
}: {
  instanceId: string;
  items: Array<
    | { id: string; type: "feed"; timestamp: string; item: LiveFeedItem }
    | { id: string; type: "log"; timestamp: string; item: ActivityLogItem }
  >;
  error?: string;
}) {
  const visibleItems = items.slice(0, 8);

  return (
    <div className="flex h-full min-h-[360px] w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card p-4 shadow-sm sm:min-h-[420px] sm:p-5">
      <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Live activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Combined message feed and system log for this instance.</p>
        </div>
      </div>
      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {visibleItems.length === 0 ? (
          <div className="grid h-full min-h-[220px] place-items-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-6 text-center text-sm text-muted-foreground">
            No activity yet for this instance. Connect, send a message, or wait for inbound traffic — logs and conversations will appear here.
          </div>
        ) : (
          visibleItems.map((entry, index) => (
          <div
            key={entry.id}
            style={{ animationDelay: `${index * 35}ms` }}
            className={cn(
              "group relative py-2 animate-feed-ticket",
              index === visibleItems.length - 1 && items.length > visibleItems.length && "!opacity-70",
            )}
          >
            <div className="relative rounded-xl bg-background/55 p-4 transition-all duration-200 group-hover:bg-background group-hover:shadow-md">
              {entry.type === "log" ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm font-semibold">
                      <div className="overflow-hidden text-ellipsis whitespace-nowrap transition-all duration-300 group-hover:whitespace-normal group-hover:overflow-visible">
                        <span className="text-muted-foreground">[log]</span>{" "}
                        <span className={levelHeadingClass(entry.item.level)}>{displayLogLevel(entry.item.level)}</span>
                      </div>
                      <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-normal text-muted-foreground transition-all duration-300 group-hover:whitespace-normal group-hover:overflow-visible">
                        {entry.item.source}
                      </p>
                    </div>
                    <span className={timestampTagClass()}>{entry.item.time}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 text-sm font-semibold">
                      <span className={entry.item.direction === "Sent" ? "italic" : ""}>{entry.item.direction}</span>{" "}
                      {entry.item.phone}
                    </div>
                    <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {entry.item.time}
                    </span>
                  </div>
                  <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm text-muted-foreground transition-all duration-300 group-hover:whitespace-normal group-hover:overflow-visible">
                    {entry.item.text}
                  </p>
                </>
              )}
            </div>
          </div>
          ))
        )}
      </div>
      <Link
        to={`/deep-dive?instance=${instanceId}`}
        className="mt-5 inline-flex w-fit shrink-0 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        See more
      </Link>
    </div>
  );
}

function SettingsAccordionCard({
  icon: Icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="font-semibold">{title}</span>
        </span>
        <ChevronDownIcon className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-border/60">{children}</div>}
    </div>
  );
}

function HandoffNumbersOverlay({
  numbers,
  handoffsCleared,
  onChange,
  onClearHandoffs,
  onClose,
}: {
  numbers: string[];
  handoffsCleared: boolean;
  onChange: (numbers: string[]) => void;
  onClearHandoffs: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const filteredNumbers = numbers.filter((number) => number.toLowerCase().includes(query.toLowerCase()));

  const addNumber = () => {
    const nextNumber = draft.trim();
    if (!nextNumber || numbers.includes(nextNumber)) return;
    onChange([nextNumber, ...numbers]);
    setDraft("");
  };

  const removeNumber = (number: string) => {
    onChange(numbers.filter((item) => item !== number));
  };

  const clearHandoffs = () => {
    if (!window.confirm("Clear all active handoffs? Tagged numbers will stay saved.")) return;
    onClearHandoffs();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
      <div className="relative flex h-[92dvh] max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl animate-pop-in sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-4 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold">Manage tagged numbers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search, add, or remove numbers notified during human handoff.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tagged numbers..."
              className="h-11 w-full rounded-xl border border-border/60 bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-muted/20 p-3 sm:flex-row">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addNumber();
              }}
              placeholder="+15551234567"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring/30"
            />
            <button
              onClick={addNumber}
              disabled={!draft.trim()}
              className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              Add number
            </button>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-background p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">Active handoffs</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Clear all active handoff assignments while keeping this tagged number list.
              </p>
              {handoffsCleared && (
                <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
                  Handoffs cleared.
                </p>
              )}
            </div>
            <button
              onClick={clearHandoffs}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              <Trash2Icon className="h-4 w-4" />
              Clear handoffs
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border/60">
            {filteredNumbers.length > 0 ? (
              filteredNumbers.map((number) => (
                <div key={number} className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <span className="break-all font-mono text-sm">{number}</span>
                  <button
                    onClick={() => removeNumber(number)}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Trash2Icon className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <div className="grid min-h-40 place-items-center p-6 text-center text-sm text-muted-foreground">
                No tagged numbers match your search.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DeleteInstanceSheet({
  instanceName,
  onClose,
  onConfirm,
  busy,
  error,
}: {
  instanceName: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  busy: boolean;
  error: string;
}) {
  const [typedName, setTypedName] = useState("");
  const canDelete = typedName === instanceName && !busy;

  const submitDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canDelete) return;
    void onConfirm();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submitDelete}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-2xl animate-pop-in sm:rounded-3xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300">
              <Trash2Icon className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Delete {instanceName}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This removes the worker-side WhatsApp instance and auth, releases its proxy, and marks the control-plane row deleted. Type{" "}
              <span className="font-mono font-semibold text-foreground">{instanceName}</span>{" "}
              exactly to enable deletion.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close delete sheet"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-6 block">
          <span className="mb-2 block text-sm font-medium">Instance name</span>
          <input
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            placeholder={instanceName}
            className="h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/30"
            autoFocus
          />
        </label>

        {error && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canDelete}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2Icon className="h-4 w-4" />
            {busy ? "Deleting..." : "Delete instance"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function ConnectOverlay({
  instanceId,
  connected,
  onClose,
  onConnected,
}: {
  instanceId: string;
  connected: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [mode, setMode] = useState<ConnectMode>("menu");
  const [loading, setLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [authCleared, setAuthCleared] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [qrUpdatedAt, setQrUpdatedAt] = useState<string | null>(null);
  const [qrVersion, setQrVersion] = useState(0);
  const [qrExpiresInMs, setQrExpiresInMs] = useState<number | null>(null);
  const [qrRefreshRestartCount, setQrRefreshRestartCount] = useState(0);
  const [pairingStatus, setPairingStatus] = useState("");
  const qrRefreshInFlight = useRef(false);

  const requestFreshQr = async () => {
    if (qrRefreshInFlight.current) return;
    qrRefreshInFlight.current = true;
    try {
      await connectInstance(instanceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/connection in progress/i.test(message)) {
        throw error;
      }
    } finally {
      qrRefreshInFlight.current = false;
    }
  };

  useEffect(() => {
    if (mode !== "qr") return;

    let cancelled = false;
    const pollQr = async () => {
      try {
        const latest = (await getInstanceQr(instanceId)).worker;
        if (cancelled) return;

        if (latest.status === "connected") {
          onConnected();
          return;
        }

        if (latest.qrCode) {
          const expiresInMs = getQrExpiresInMs(latest.qrCodeUpdatedAt, latest.qrExpiresInMs);
          if (typeof expiresInMs === "number" && expiresInMs <= 0) {
            setQrCode(null);
            setQrExpiresInMs(0);
            setPairingStatus("Refreshing QR...");
            setConnectError("");
            setLoading(true);
            requestFreshQr().catch(() => {
              if (!cancelled) {
                setLoading(false);
              }
            });
            return;
          }
          setQrCode(latest.qrCode);
          setQrUpdatedAt(latest.qrCodeUpdatedAt || null);
          setQrVersion(latest.qrVersion || 0);
          setQrExpiresInMs(expiresInMs);
          setQrRefreshRestartCount(latest.qrRefreshRestartCount || 0);
          setPairingStatus("");
          setConnectError("");
          setLoading(false);
          return;
        }

        if (latest.linkingGraceActive || latest.connectionIssue?.message) {
          setQrCode(null);
          setLoading(false);
          setPairingStatus(latest.connectionIssue?.message || "Scan received, finishing WhatsApp link...");
          setConnectError("");
          return;
        }

        if (latest.status === "disconnected") {
          setLoading(true);
          setPairingStatus("Refreshing QR...");
          setConnectError("");
          requestFreshQr().catch((error) => {
            if (!cancelled) {
              setLoading(false);
              setConnectError(
                error instanceof Error
                  ? error.message
                  : latest.connectionIssue?.message ||
                      latest.message ||
                      "QR pairing stopped. Retrying automatically...",
              );
            }
          });
          return;
        }

        setQrRefreshRestartCount(latest.qrRefreshRestartCount || 0);
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setConnectError(error instanceof Error ? error.message : "Could not refresh QR code.");
        }
      }
    };

    pollQr();
    const timer = window.setInterval(pollQr, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [instanceId, mode, onConnected]);

  const showQr = async () => {
    setMode("qr");
    setQrCode(null);
    setQrUpdatedAt(null);
    setQrVersion(0);
    setQrExpiresInMs(null);
    setQrRefreshRestartCount(0);
    setPairingStatus("");
    setConnectError("");
    setLoading(true);
    let keepPreparing = false;
    try {
      await requestFreshQr();
      const qr = await waitForQr(instanceId);
      if (qr.status === "connected") {
        onConnected();
        return;
      }
      if (!qr.qrCode) {
        if (qr.status === "connecting") {
          keepPreparing = true;
          setConnectError("");
        } else {
          setConnectError(qr.message || "QR is not ready yet. Try again in a few seconds.");
        }
        return;
      }
      const expiresInMs = getQrExpiresInMs(qr.qrCodeUpdatedAt, qr.qrExpiresInMs);
      if (typeof expiresInMs === "number" && expiresInMs <= 0) {
        keepPreparing = true;
        setPairingStatus("Refreshing QR...");
        return;
      }
      setQrCode(qr.qrCode);
      setQrUpdatedAt(qr.qrCodeUpdatedAt || null);
      setQrVersion(qr.qrVersion || 0);
      setQrExpiresInMs(expiresInMs);
      setQrRefreshRestartCount(qr.qrRefreshRestartCount || 0);
      setPairingStatus("");
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not start WhatsApp connection.");
    } finally {
      setLoading(keepPreparing);
    }
  };

  const generatePairingCode = async () => {
    setMode("pairing");
    setLoading(true);
    setConnectError("");
    setPairingCode("");
    try {
      const response = await connectInstance(instanceId, { pairingPhone: phone });
      const code = response.worker.pairingCode || response.worker.instance?.pairingCode || "";
      if (!code) {
        setConnectError("Pairing code was not returned by the worker. Try QR pairing instead.");
        return;
      }
      setPairingCode(code);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not generate pairing code.");
    } finally {
      setLoading(false);
    }
  };

  const clearAuth = async () => {
    if (!window.confirm("Clear saved WhatsApp auth for this instance? You will need to pair again.")) return;
    setMode("clear");
    setLoading(true);
    setConnectError("");
    setAuthCleared(false);
    try {
      await clearInstanceAuth(instanceId);
      setAuthCleared(true);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not clear saved auth.");
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
      <div className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl animate-pop-in sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-4 sm:p-6">
          <div>
            <h2 className="text-xl font-semibold">Connect WhatsApp</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pair this instance with QR, an 8 digit pairing code, or clear saved auth first.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 sm:p-6 md:grid-cols-[260px_minmax(0,1fr)] md:gap-5">
          <div className="space-y-3">
            <ActionTile
              active={mode === "qr"}
              icon={QrCodeIcon}
              title="QR code"
              body="Scan from WhatsApp linked devices."
              onClick={showQr}
            />
            <ActionTile
              active={mode === "pairing"}
              icon={KeyRoundIcon}
              title="Pairing code"
              body="Enter a phone number and generate a code."
              onClick={() => setMode("pairing")}
            />
            <ActionTile
              active={mode === "clear"}
              icon={LinkIcon}
              title="Clear auth"
              body={connected ? "Wipe saved auth before pairing again." : "Reset saved auth state."}
              onClick={clearAuth}
            />
          </div>

          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-border/60 bg-muted/20 p-4 sm:min-h-[360px] sm:p-6">
            {mode === "menu" && (
              <div className="max-w-sm text-center">
                <MessageCircleIcon className="mx-auto h-10 w-10 text-muted-foreground" />
                <h3 className="mt-4 font-semibold">Choose a pairing method</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  The modal is attached to the viewport, so it stays centered outside the instance content layout.
                </p>
              </div>
            )}

            {mode === "qr" && (
              <div className="w-full max-w-sm text-center">
                {loading && <LoadingState label="Preparing QR code" />}
                {!loading && connectError && (
                  <div>
                    <ErrorState message={connectError} />
                    <button
                      onClick={showQr}
                      className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      Retry QR
                    </button>
                  </div>
                )}
                {!loading && !connectError && pairingStatus && (
                  <div className="rounded-2xl border border-border/60 bg-background p-5">
                    <LoadingState label={pairingStatus} />
                    <p className="mt-3 text-xs text-muted-foreground">Keep WhatsApp open while the link finishes. A fresh QR will appear automatically if this attempt times out.</p>
                  </div>
                )}
                {!loading && qrCode && (
                  <>
                    <img src={qrCode} alt="WhatsApp pairing QR code" className="mx-auto h-48 w-48 rounded-2xl border border-border bg-white p-3 shadow-inner sm:h-56 sm:w-56" />
                    <p className="mt-4 text-sm text-muted-foreground">Scan this QR in WhatsApp linked devices. It refreshes automatically while this modal stays open.</p>
                    {(qrUpdatedAt || qrVersion > 0) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {qrVersion > 0 ? `QR version ${qrVersion}` : "QR refreshed"}
                        {qrUpdatedAt ? ` · Updated ${new Date(qrUpdatedAt).toLocaleTimeString()}` : ""}
                        {typeof qrExpiresInMs === "number" ? ` · Expires in ${Math.max(0, Math.ceil(qrExpiresInMs / 1000))}s` : ""}
                        {qrRefreshRestartCount > 0 ? ` · Auto-refresh restarts ${qrRefreshRestartCount}` : ""}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {mode === "pairing" && (
              <div className="w-full max-w-sm">
                <label className="text-sm font-medium">Phone number</label>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+15551234567"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                  />
                  <button
                    onClick={generatePairingCode}
                    disabled={!phone.trim() || loading}
                    className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                  >
                    Generate
                  </button>
                </div>
                <div className="mt-8 grid min-h-32 place-items-center rounded-2xl border border-border/60 bg-background p-5 text-center">
                  {loading && <LoadingState label="Generating code" />}
                  {!loading && connectError && <ErrorState message={connectError} />}
                  {!loading && pairingCode && (
                    <div>
                      <div className="font-mono text-3xl font-semibold tracking-[0.24em] sm:text-4xl sm:tracking-[0.35em]">{pairingCode}</div>
                      <p className="mt-3 text-sm text-muted-foreground">Enter this 8 digit code in WhatsApp.</p>
                    </div>
                  )}
                  {!loading && !pairingCode && !connectError && (
                    <p className="text-sm text-muted-foreground">Enter a phone number to generate an 8 digit code.</p>
                  )}
                </div>
              </div>
            )}

            {mode === "clear" && (
              <div className="max-w-sm text-center">
                {loading && <LoadingState label="Clearing auth" />}
                {!loading && connectError && <ErrorState message={connectError} />}
                {!loading && authCleared ? (
                  <>
                    <CheckIcon className="mx-auto h-10 w-10 text-emerald-600" />
                    <h3 className="mt-4 font-semibold">Auth cleared</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Saved credentials were cleared.</p>
                    <button
                      onClick={showQr}
                      className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      Show QR next
                    </button>
                  </>
                ) : !loading && !connectError ? (
                  <p className="text-sm text-muted-foreground">Use the clear auth option to reset pairing credentials.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function waitForQr(instanceId: string) {
  let latest = await getInstanceQr(instanceId);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (latest.worker.qrCode || latest.worker.status === "connected") return latest.worker;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    latest = await getInstanceQr(instanceId);
  }
  return latest.worker;
}

function ActionTile({
  active,
  icon: Icon,
  title,
  body,
  onClick,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors",
        active ? "border-foreground bg-foreground text-background" : "border-border/60 hover:bg-muted/50",
      )}
    >
      <div className={cn("grid h-11 w-11 place-items-center rounded-lg", active ? "bg-background/15" : "bg-muted")}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className={cn("mt-0.5 text-sm", active ? "text-background/75" : "text-muted-foreground")}>{body}</p>
      </div>
    </button>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid place-items-center gap-3 text-center">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      <p className="text-sm text-muted-foreground">{label}...</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
      {message}
    </div>
  );
}

function getInstanceHealth(connected: boolean, status: string, qualityScore: string) {
  if (status === "connecting") {
    return { label: "Pairing pending", className: "text-amber-600 dark:text-amber-300" };
  }

  if (!connected || status === "offline" || status === "provisioning") {
    return { label: "Critical health", className: "text-red-600 dark:text-red-400" };
  }

  if (status === "quality-warning" || /warning|low/i.test(qualityScore)) {
    return { label: "Low health", className: "text-amber-600 dark:text-amber-400" };
  }

  return { label: "Healthy", className: "text-emerald-600 dark:text-emerald-400" };
}

function timestampTagClass() {
  return "inline-flex w-fit items-center justify-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground";
}

function displayLogLevel(level: string) {
  if (level === "Critical") return "CRITICAL";
  if (level === "High") return "Medium";
  if (level === "Low") return "small";
  return level;
}

function normalizeKeyword(value: string) {
  const trimmed = value.trim().replace(/^#+/, "");
  if (!trimmed) return "";
  return `#${trimmed.replace(/\s+/g, "-").toLowerCase()}`;
}

function levelHeadingClass(level: string) {
  return cn(
    "font-semibold",
    level === "Critical" && "uppercase text-red-600 dark:text-red-400",
    level === "High" && "text-amber-600 dark:text-amber-300",
    level === "Low" && "text-zinc-600 dark:text-zinc-300",
  );
}

function mapSeverity(severity: string): ActivityLogItem["level"] {
  if (severity === "critical" || severity === "error") return "Critical";
  if (severity === "warning") return "High";
  if (severity === "debug") return "Low";
  return "Medium";
}

function formatActivityTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Live";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m ago`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h ago`;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
