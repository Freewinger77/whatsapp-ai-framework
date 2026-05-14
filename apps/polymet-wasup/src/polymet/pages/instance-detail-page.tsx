import type { ComponentType, FormEvent, KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import {
  ActivityIcon,
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
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
  INSTANCE_ACTIVITY_LOG,
  INSTANCES,
  LIVE_FEED,
} from "@/polymet/data/dashboard-data";
import { instanceGradient } from "@/polymet/data/instance-colors";
import { cn } from "@/lib/utils";

type ActivityLogItem = (typeof INSTANCE_ACTIVITY_LOG)[number];
type LiveFeedItem = (typeof LIVE_FEED)[number];
type ConnectMode = "menu" | "qr" | "pairing" | "clear";
type MainSettingsCard = "webhook" | "handoff" | "profile" | "behaviour" | "anti-ban" | "proxy";

const DEFAULT_HANDOFF_NUMBERS = [
  "+4478392039923",
  "+44778392039923",
  "+447700900321",
  "+60123456789",
  "+60192345678",
  "+6581234567",
  "+6587654321",
  "+61412345678",
  "+61498765432",
  "+12025550183",
  "+12025550194",
  "+14155552671",
  "+14155552682",
  "+442071838750",
  "+442071838761",
  "+493012345678",
  "+33123456789",
  "+358401234567",
];

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const inst =
    INSTANCES.find((i) => i.id === id) ?? {
      id: id ?? "",
      name: id ?? "Instance",
      region: "Pending",
      status: "provisioning" as const,
      phone: "Not linked",
      webhookUrl: "https://n8n.wasup.ai/webhook/new-instance",
      behaviorProfile: "Notification balanced" as const,
      proxy: "pending",
      messagesToday: "0",
      uptime: "Pending",
      qualityScore: "Pending",
    };

  const [dirty, setDirty] = useState(false);
  const [instanceName, setInstanceName] = useState(inst.name);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(inst.name);
  const [webhookUrl, setWebhookUrl] = useState(inst.webhookUrl);
  const [signingSecret, setSigningSecret] = useState("whsec_mocked_per_org");
  const [handoffMessage, setHandoffMessage] = useState(
    "Great, I'll take over the chat now. Happy to help!",
  );
  const [resumeKeywords, setResumeKeywords] = useState(["#resume", "#continue", "#bot-on"]);
  const [handoffNumbers, setHandoffNumbers] = useState(DEFAULT_HANDOFF_NUMBERS);
  const [handoffManagerOpen, setHandoffManagerOpen] = useState(false);
  const [profileDisplayName, setProfileDisplayName] = useState(inst.name);
  const [profileAbout, setProfileAbout] = useState("Fast replies powered by Wasup");
  const [profilePictureUrl, setProfilePictureUrl] = useState(
    "https://assets.wasup.ai/profiles/wasup-operator.png",
  );
  const [pictureStatus, setPictureStatus] = useState("Picture loaded in mock");
  const [pictureModalOpen, setPictureModalOpen] = useState(false);
  const [notificationGrace, setNotificationGrace] = useState(
    inst.behaviorProfile === "Bot-native" ? "0" : "8",
  );
  const [behaviorProfile, setBehaviorProfile] = useState(inst.behaviorProfile);
  const [connected, setConnected] = useState(inst.status !== "provisioning");
  const [linkOpen, setLinkOpen] = useState(false);
  const [typing, setTyping] = useState(inst.behaviorProfile !== "Notification max");
  const [readReceipts, setReadReceipts] = useState(inst.behaviorProfile !== "Notification max");
  const [responseDelays, setResponseDelays] = useState(false);
  const [handoffsCleared, setHandoffsCleared] = useState(false);
  const [pictureRemoved, setPictureRemoved] = useState(false);
  const [openSettingsCard, setOpenSettingsCard] = useState<MainSettingsCard>("webhook");
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const [deleteScheduled, setDeleteScheduled] = useState(false);

  const instanceLogs = INSTANCE_ACTIVITY_LOG.filter((item) => item.instanceId === inst.id);
  const instanceFeed = LIVE_FEED.filter((item) => item.instanceId === inst.id);
  const statusLabel = connected ? "active" : "disconnected";
  const health = getInstanceHealth(connected, inst.status, inst.qualityScore);

  const activityItems = useMemo(
    () =>
      [
        ...instanceFeed.map((item) => ({
          id: `feed-${item.timestamp}-${item.direction}`,
          type: "feed" as const,
          timestamp: item.timestamp,
          item,
        })),
        ...instanceLogs.map((item) => ({
          id: `log-${item.timestamp}-${item.level}`,
          type: "log" as const,
          timestamp: item.timestamp,
          item,
        })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    [instanceFeed, instanceLogs],
  );

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
    setTitleEditing(false);
  }, [inst.id, inst.name]);

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

  const saveTitle = () => {
    setInstanceName(titleDraft.trim() || inst.name);
    markDirty();
    setTitleEditing(false);
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
    setPictureStatus("Picture loaded and set in mock");
    setPictureModalOpen(false);
    markDirty();
  };

  const removeProfilePicture = () => {
    setProfilePictureUrl("");
    setPictureRemoved(true);
    setPictureStatus("Picture removed in mock");
    markDirty();
  };

  const requestDelete = () => {
    if (deleteScheduled) return;
    if (!window.confirm("Are you sure?")) return;
    setDeleteSheetOpen(true);
  };

  const confirmDelete = () => {
    setDeleteScheduled(true);
    setDeleteSheetOpen(false);
    setDirty(false);
  };

  return (
    <div className="space-y-8">
      {deleteScheduled && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          <div className="flex items-center gap-2 font-semibold">
            <CheckIcon className="h-4 w-4" />
            Delete scheduled
          </div>
          <p className="mt-1 text-red-700/80 dark:text-red-200/80">
            {instanceName} is marked for deletion in this mock control-plane state.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div
          className="h-20 w-20 shrink-0 rounded-2xl shadow-sm"
          style={{ background: instanceGradient(inst.id) }}
        />
        <div className="flex-1">
          <div
            className={cn(
              "flex items-center gap-2 text-xs font-medium uppercase tracking-wider",
              connected ? "text-emerald-600" : "text-red-600 dark:text-red-400",
            )}
          >
            <CircleIcon className="h-2 w-2" fill="currentColor" stroke="none" />
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
                className="h-11 min-w-0 rounded-lg border border-border/60 bg-background px-3 text-3xl font-semibold tracking-tight outline-none focus:ring-2 focus:ring-ring/30"
                autoFocus
              />
            ) : (
              <h1 className="text-3xl font-semibold tracking-tight">{instanceName}</h1>
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
        <div className="flex gap-2">
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
            onClick={() => setDirty(false)}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            Save settings
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { icon: ActivityIcon, label: "Messages today", value: inst.messagesToday },
          { icon: ClockIcon, label: "Uptime", value: connected ? inst.uptime : "Disconnected" },
          { icon: GlobeIcon, label: "Region", value: inst.region },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="rounded-xl border border-border/60 bg-card p-5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4" />
                {stat.label}
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">{stat.value}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[420px_minmax(0,1fr)] xl:items-stretch">
        <section className="min-h-0 xl:self-stretch">
          <LiveActivityPanel instanceId={inst.id} items={activityItems} />
        </section>

        <section className="flex min-h-0 flex-col gap-4">
          <SettingsAccordionCard
            icon={WebhookIcon}
            title="Webhook"
            open={openSettingsCard === "webhook"}
            onToggle={() => setOpenSettingsCard("webhook")}
          >
            <EditableTextRow label="Inbound webhook" value={webhookUrl} onSave={setWebhookUrl} onDirty={markDirty} />
            <EditableTextRow label="Webhook signing secret" value={signingSecret} onSave={setSigningSecret} onDirty={markDirty} monospace />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={HandIcon}
            title="Human handoff"
            open={openSettingsCard === "handoff"}
            onToggle={() => setOpenSettingsCard("handoff")}
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
                Active handoffs cleared in this mock state.
              </div>
            )}
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={UserRoundIcon}
            title="WhatsApp profile"
            open={openSettingsCard === "profile"}
            onToggle={() => setOpenSettingsCard("profile")}
          >
            <EditableTextRow label="Display name" value={profileDisplayName} onSave={setProfileDisplayName} onDirty={markDirty} />
            <EditableTextRow label="About / status text" value={profileAbout} onSave={setProfileAbout} onDirty={markDirty} />
            <ProfilePictureRow onSet={setProfilePicture} onRemove={removeProfilePicture} status={pictureStatus} removed={pictureRemoved} />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={SlidersHorizontalIcon}
            title="Behaviour"
            open={openSettingsCard === "behaviour"}
            onToggle={() => setOpenSettingsCard("behaviour")}
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
            open={openSettingsCard === "anti-ban"}
            onToggle={() => setOpenSettingsCard("anti-ban")}
          >
            <StaticRow label="Quality score" value={connected ? inst.qualityScore : "Disconnected"} />
            <StaticRow label="Daily send cap" value="1,000 messages" />
            <StaticRow label="Credits consumed today" value={inst.messagesToday} />
            <StaticRow label="Presence cycling" value="Unavailable between bursts" />
          </SettingsAccordionCard>

          <SettingsAccordionCard
            icon={GlobeIcon}
            title="Proxy and region"
            open={openSettingsCard === "proxy"}
            onToggle={() => setOpenSettingsCard("proxy")}
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
                  Delete this instance from the mock control plane. You will be asked to confirm and type the instance name exactly.
                </p>
              </div>
              <button
                type="button"
                onClick={requestDelete}
                disabled={deleteScheduled}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-background px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/80 dark:text-red-200 dark:hover:bg-red-950/40"
              >
                <Trash2Icon className="h-4 w-4" />
                {deleteScheduled ? "Delete scheduled" : "Delete instance"}
              </button>
            </div>
          </div>
        </section>
      </div>

      {linkOpen && (
        <ConnectOverlay
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
        />
      )}
      {pictureModalOpen && (
        <ProfilePictureOverlay
          currentUrl={profilePictureUrl}
          onClose={() => setPictureModalOpen(false)}
          onConfirm={confirmProfilePicture}
        />
      )}
    </div>
  );
}

function ManageNumbersRow({ count, onManage }: { count: number; onManage: () => void }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border/60 px-5 py-4 last:border-b-0">
      <div className="text-sm text-muted-foreground">Phone number to tag</div>
      <div className="flex items-center gap-3">
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
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div>
        <div className="text-sm text-muted-foreground">Profile picture</div>
        <div className={cn("mt-1 text-sm", removed ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400")}>
          {status}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
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
    <div className="fixed inset-0 z-[110] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg rounded-3xl border border-border bg-background p-6 shadow-2xl animate-pop-in">
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
    <div className="flex items-center justify-between gap-6 border-b border-border/60 px-5 py-4 last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="max-w-[60%] truncate text-right font-mono text-sm">{value}</div>
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
    <div className="border-b border-border/60 px-5 py-4">
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
}: {
  label: string;
  value: string;
  onSave: (value: string) => void;
  onDirty: () => void;
  monospace?: boolean;
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
    <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="flex min-w-0 flex-1 justify-end gap-2">
        {editing ? (
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className={cn(
              "h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-right text-sm outline-none focus:ring-2 focus:ring-ring/30 md:max-w-[420px]",
              monospace && "font-mono",
            )}
          />
        ) : (
          <div
            className={cn(
              "min-w-0 flex-1 truncate text-right text-sm md:max-w-[420px]",
              monospace ? "font-mono" : "font-medium",
            )}
          >
            {value}
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
    <div className="flex items-center justify-between gap-6 border-b border-border/60 px-5 py-4 last:border-b-0">
      <div className="text-sm text-muted-foreground">{label}</div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as TValue)}
        className="h-9 rounded-md border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
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
    <div className="flex items-center justify-between gap-6 border-b border-border/60 px-5 py-4 last:border-b-0">
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
}: {
  instanceId: string;
  items: Array<
    | { id: string; type: "feed"; timestamp: string; item: LiveFeedItem }
    | { id: string; type: "log"; timestamp: string; item: ActivityLogItem }
  >;
}) {
  const visibleItems = items.slice(0, 8);

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="mb-5 flex shrink-0 items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Live activity</h2>
          <p className="mt-1 text-sm text-muted-foreground">Combined message feed and system log for this instance.</p>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-hidden">
        {visibleItems.map((entry, index) => (
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
        ))}
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
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-muted/35"
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
    <div className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative flex h-[90vh] max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl animate-pop-in">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-6">
          <div>
            <h2 className="text-xl font-semibold">Manage tagged numbers</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Search, add, or remove the mock numbers notified during human handoff.
            </p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted">
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
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
              placeholder="+4478392039923"
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
                  Handoffs cleared in this mock state.
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
                <div key={number} className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0">
                  <span className="font-mono text-sm">{number}</span>
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
}: {
  instanceName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typedName, setTypedName] = useState("");
  const canDelete = typedName === instanceName;

  const submitDelete = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canDelete) return;
    onConfirm();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in sm:p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submitDelete}
        className="w-full max-w-xl rounded-3xl border border-border bg-background p-6 shadow-2xl animate-pop-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300">
              <Trash2Icon className="h-5 w-5" />
            </div>
            <h2 className="text-xl font-semibold tracking-tight">Delete {instanceName}?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This mock action schedules the instance for deletion. Type{" "}
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
            Delete instance
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function ConnectOverlay({
  connected,
  onClose,
  onConnected,
}: {
  connected: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [mode, setMode] = useState<ConnectMode>("menu");
  const [loading, setLoading] = useState(false);
  const [qrReady, setQrReady] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [authCleared, setAuthCleared] = useState(false);

  const showQr = () => {
    setMode("qr");
    setQrReady(false);
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setQrReady(true);
    }, 850);
  };

  const generatePairingCode = () => {
    setMode("pairing");
    setLoading(true);
    setPairingCode("");
    window.setTimeout(() => {
      setLoading(false);
      setPairingCode(String(Math.floor(10000000 + Math.random() * 90000000)));
    }, 850);
  };

  const clearAuth = () => {
    if (!window.confirm("Clear saved WhatsApp auth for this instance? You will need to pair again.")) return;
    setMode("clear");
    setAuthCleared(true);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-screen w-screen items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-fade-in">
      <div className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-2xl animate-pop-in">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 p-6">
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

        <div className="grid gap-5 overflow-y-auto p-6 md:grid-cols-[260px_minmax(0,1fr)]">
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
              body={connected ? "Wipe saved auth before pairing again." : "Reset the mock auth state."}
              onClick={clearAuth}
            />
          </div>

          <div className="grid min-h-[360px] place-items-center rounded-2xl border border-border/60 bg-muted/20 p-6">
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
                {qrReady && (
                  <>
                    <QrMock />
                    <p className="mt-4 text-sm text-muted-foreground">Scan this mock QR in WhatsApp linked devices.</p>
                    <button
                      onClick={onConnected}
                      className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      Simulate scanned
                    </button>
                  </>
                )}
              </div>
            )}

            {mode === "pairing" && (
              <div className="w-full max-w-sm">
                <label className="text-sm font-medium">Phone number</label>
                <div className="mt-2 flex gap-2">
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+4478392039923"
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
                  {!loading && pairingCode && (
                    <div>
                      <div className="font-mono text-4xl font-semibold tracking-[0.35em]">{pairingCode}</div>
                      <p className="mt-3 text-sm text-muted-foreground">Enter this 8 digit code in WhatsApp.</p>
                      <button
                        onClick={onConnected}
                        className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                      >
                        Simulate paired
                      </button>
                    </div>
                  )}
                  {!loading && !pairingCode && (
                    <p className="text-sm text-muted-foreground">Enter a phone number to generate an 8 digit code.</p>
                  )}
                </div>
              </div>
            )}

            {mode === "clear" && (
              <div className="max-w-sm text-center">
                {authCleared ? (
                  <>
                    <CheckIcon className="mx-auto h-10 w-10 text-emerald-600" />
                    <h3 className="mt-4 font-semibold">Auth cleared</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Saved credentials were cleared in this mock state.</p>
                    <button
                      onClick={showQr}
                      className="mt-5 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
                    >
                      Show QR next
                    </button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Use the clear auth option to reset pairing credentials.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
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

function QrMock() {
  return (
    <div className="mx-auto grid h-56 w-56 grid-cols-7 gap-1 rounded-2xl border border-border bg-background p-4 shadow-inner">
      {Array.from({ length: 49 }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "rounded-[3px]",
            [0, 1, 2, 7, 14, 42, 43, 44, 35, 28, 4, 6, 12, 16, 19, 22, 24, 31, 33, 38, 40, 46].includes(index)
              ? "bg-foreground"
              : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

function getInstanceHealth(connected: boolean, status: string, qualityScore: string) {
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
