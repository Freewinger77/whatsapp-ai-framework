import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileCodeIcon,
  Gamepad2Icon,
  ListPlusIcon,
  MessageSquareIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SendIcon,
  ServerIcon,
} from "lucide-react";
import { toast } from "sonner";
import { REGION_OPTIONS, type Instance } from "@/polymet/data/dashboard-data";
import { ACTIVE_DEPLOYMENT_STATUSES, useWorkspaceState } from "@/polymet/hooks/use-workspace-state";
import {
  connectInstance,
  createInstance,
  getConnection,
  getDeepDive,
  getInstanceQr,
  getPlaygroundWorkerHealth,
  listInstances,
  sendInstanceMessage,
  type ControlPlaneConnection,
  type DeepDiveResult,
  type PlaygroundWorkerHealth,
} from "@/polymet/lib/control-plane-api";
import { getWorkerBaseUrl, getWorkerLinks } from "@/polymet/lib/worker-links";
import { cn } from "@/lib/utils";

const DEFAULT_RESPONSE = "Run a playground action to see the request result here.";

export function PlaygroundPage() {
  const { instances: workspaceInstances, refresh } = useWorkspaceState();
  const [instances, setInstances] = useState<Instance[]>(workspaceInstances);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");
  const [connection, setConnection] = useState<ControlPlaneConnection | null>(null);
  const [workerHealth, setWorkerHealth] = useState<PlaygroundWorkerHealth | null>(null);
  const [activity, setActivity] = useState<DeepDiveResult | null>(null);
  const [responseText, setResponseText] = useState(DEFAULT_RESPONSE);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const [createName, setCreateName] = useState("Playground instance");
  const [createRegion, setCreateRegion] = useState<(typeof REGION_OPTIONS)[number]>("Finland");
  const [createWebhook, setCreateWebhook] = useState("");
  const [pairingPhone, setPairingPhone] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendMessage, setSendMessage] = useState("Hello from the Wasup dashboard playground.");
  const [buttonMessage, setButtonMessage] = useState("Choose an option");
  const [buttonFooter, setButtonFooter] = useState("Wasup");
  const [buttonLabels, setButtonLabels] = useState(["Yes", "No", "Talk to human"]);

  useEffect(() => {
    setInstances(workspaceInstances);
  }, [workspaceInstances]);

  useEffect(() => {
    if (!selectedInstanceId && instances[0]) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  useEffect(() => {
    void loadOverview();
  }, []);

  const selectedInstance = useMemo(
    () => instances.find((instance) => instance.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId],
  );
  const workerBaseUrl = connection ? getWorkerBaseUrl(connection) : workerHealth?.connection.baseUrl || "";
  const workerLinks = getWorkerLinks(workerBaseUrl);
  const provisioningActive = connection ? ACTIVE_DEPLOYMENT_STATUSES.has(connection.deployment.status) : false;

  const runAction = async (label: string, action: () => Promise<unknown>) => {
    setBusyAction(label);
    try {
      const result = await action();
      setResponseText(formatResponse(label, result));
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed";
      setResponseText(formatResponse(label, { error: message }));
      toast.error(label, { description: message });
      return null;
    } finally {
      setBusyAction(null);
    }
  };

  async function loadOverview() {
    await runAction("Refresh status", async () => {
      const [nextConnection, nextWorkerHealth, nextInstances, nextActivity] = await Promise.all([
        getConnection(),
        getPlaygroundWorkerHealth(),
        listInstances(),
        getDeepDive({ type: "all" }),
      ]);
      setConnection(nextConnection);
      setWorkerHealth(nextWorkerHealth);
      setInstances(nextInstances);
      setActivity(nextActivity);
      return {
        connection: {
          status: nextConnection.deployment.status,
          baseUrl: getWorkerBaseUrl(nextConnection),
        },
        worker: nextWorkerHealth.worker,
        instances: nextInstances.length,
        logs: nextActivity.logs.length,
        messages: nextActivity.messages.length,
      };
    });
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("Create instance", async () => {
      const result = await createInstance({
        name: createName.trim() || "Playground instance",
        region: createRegion,
        webhookUrl: createWebhook.trim() || undefined,
      });
      await refresh();
      const nextInstances = await listInstances();
      setInstances(nextInstances);
      setSelectedInstanceId(result.instance.id);
      return result;
    });
  }

  async function connectSelected() {
    if (!selectedInstanceId) return toast.error("Choose an instance first");
    await runAction("Connect instance", async () => {
      const connect = await connectInstance(selectedInstanceId, pairingPhone.trim() ? { pairingPhone: pairingPhone.trim() } : {});
      const qr = await getInstanceQr(selectedInstanceId);
      setQrCode(qr.worker.qrCode);
      setPairingCode(connect.worker.pairingCode || connect.worker.instance?.pairingCode || qr.worker.pairingCode || null);
      return { connect, qr };
    });
  }

  async function refreshQr() {
    if (!selectedInstanceId) return toast.error("Choose an instance first");
    await runAction("Refresh QR", async () => {
      const qr = await getInstanceQr(selectedInstanceId);
      setQrCode(qr.worker.qrCode);
      setPairingCode(qr.worker.pairingCode);
      return qr;
    });
  }

  async function sendPlainMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInstanceId) return toast.error("Choose an instance first");
    await runAction("Send message", () =>
      sendInstanceMessage(selectedInstanceId, {
        to: sendTo.trim(),
        message: sendMessage,
        typingSimulation: true,
        delayEnabled: false,
      }),
    );
  }

  async function sendButtons(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedInstanceId) return toast.error("Choose an instance first");
    const buttons = buttonLabels
      .map((text, index) => ({ id: `option_${index + 1}`, text: text.trim() }))
      .filter((button) => button.text);
    await runAction("Send buttons", () =>
      sendInstanceMessage(selectedInstanceId, {
        to: sendTo.trim(),
        text: buttonMessage.trim(),
        footer: buttonFooter.trim(),
        buttons,
      }),
    );
  }

  async function loadSelectedActivity() {
    await runAction("Load logs and events", async () => {
      const result = await getDeepDive({ type: "all", instanceId: selectedInstanceId || "all" });
      setActivity(result);
      return result;
    });
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-[radial-gradient(circle_at_0%_0%,rgba(34,197,94,0.16),transparent_32%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--background)))] p-5 shadow-sm sm:p-7">
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600 dark:text-emerald-300">
              <Gamepad2Icon className="h-3.5 w-3.5" />
              In-platform playground
            </div>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-4xl">Test your workspace without leaving Wasup.</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Uses your signed-in dashboard session and control-plane routes to reach the worker safely. Org-level API keys stay on the Connection page.
            </p>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            disabled={busyAction === "Refresh status"}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCwIcon className={cn("h-4 w-4", busyAction === "Refresh status" && "animate-spin")} />
            Refresh status
          </button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <StatusCard icon={ServerIcon} label="Control plane" value={connection ? "Session OK" : "Loading"} sub="Authenticated dashboard route" />
        <StatusCard icon={ActivityIcon} label="Worker" value={workerHealth?.worker.reachable ? "Reachable" : "Pending"} sub={workerHealth?.worker.error || workerHealth?.connection.status || "Checking health"} tone={workerHealth?.worker.reachable ? "ok" : "warn"} />
        <StatusCard icon={ListPlusIcon} label="Instances" value={String(instances.length)} sub={selectedInstance?.name || "No instance selected"} />
        <StatusCard icon={CheckCircle2Icon} label="Deployment" value={connection?.deployment.status || "Unknown"} sub={workerBaseUrl || "Worker URL pending"} tone={provisioningActive ? "warn" : "ok"} />
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <PlaygroundCard title="Workspace and instances" icon={ListPlusIcon}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <div>
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Current instance</label>
                <select
                  value={selectedInstanceId}
                  onChange={(event) => setSelectedInstanceId(event.target.value)}
                  className="mt-2 h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                >
                  <option value="">Choose an instance</option>
                  {instances.map((instance) => (
                    <option key={instance.id} value={instance.id}>
                      {instance.name} - {instance.status}
                    </option>
                  ))}
                </select>
                <div className="mt-3 rounded-xl border border-border/60 bg-muted/25 p-3 text-sm text-muted-foreground">
                  {selectedInstance ? (
                    <>
                      <div className="font-mono text-foreground">{selectedInstance.id}</div>
                      <div className="mt-1">{selectedInstance.phone} · {selectedInstance.region} · {selectedInstance.status}</div>
                    </>
                  ) : (
                    "Create or select an instance to enable connect, QR, and send actions."
                  )}
                </div>
              </div>
              <form onSubmit={submitCreate} className="rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="font-semibold">Create test instance</div>
                <div className="mt-3 grid gap-3">
                  <input value={createName} onChange={(event) => setCreateName(event.target.value)} className={inputClassName} placeholder="Instance name" />
                  <select value={createRegion} onChange={(event) => setCreateRegion(event.target.value as (typeof REGION_OPTIONS)[number])} className={inputClassName}>
                    {REGION_OPTIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                  </select>
                  <input value={createWebhook} onChange={(event) => setCreateWebhook(event.target.value)} className={inputClassName} placeholder="Optional webhook URL" />
                  <button type="submit" disabled={busyAction === "Create instance"} className={primaryButtonClassName}>
                    {busyAction === "Create instance" ? "Creating..." : "Create instance"}
                  </button>
                </div>
              </form>
            </div>
          </PlaygroundCard>

          <PlaygroundCard title="Connect and QR" icon={QrCodeIcon}>
            <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <input value={pairingPhone} onChange={(event) => setPairingPhone(event.target.value)} className={inputClassName} placeholder="Optional phone for pairing code" />
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" onClick={connectSelected} className={primaryButtonClassName}>Connect</button>
                  <button type="button" onClick={refreshQr} className={secondaryButtonClassName}>Fetch QR</button>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  QR mode restarts the worker socket as needed. Clearing auth is still only available from the instance detail page.
                </p>
              </div>
              <div className="grid min-h-52 place-items-center rounded-2xl border border-border/60 bg-muted/20 p-4 text-center">
                {qrCode ? (
                  <img src={qrCode} alt="WhatsApp pairing QR" className="h-48 w-48 rounded-2xl border border-border bg-white p-3" />
                ) : pairingCode ? (
                  <div>
                    <div className="font-mono text-4xl font-semibold tracking-[0.28em]">{pairingCode}</div>
                    <p className="mt-3 text-sm text-muted-foreground">Enter this in WhatsApp linked devices.</p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Connect or fetch QR to show pairing output.</p>
                )}
              </div>
            </div>
          </PlaygroundCard>

          <PlaygroundCard title="Send messages" icon={SendIcon}>
            <div className="grid gap-4 lg:grid-cols-2">
              <form onSubmit={sendPlainMessage} className="space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="font-semibold">Text message</div>
                <input value={sendTo} onChange={(event) => setSendTo(event.target.value)} className={inputClassName} placeholder="Recipient phone, e.g. 60123456789" />
                <textarea value={sendMessage} onChange={(event) => setSendMessage(event.target.value)} className={`${inputClassName} min-h-28 py-3`} />
                <button type="submit" className={primaryButtonClassName}>Send text</button>
              </form>
              <form onSubmit={sendButtons} className="space-y-3 rounded-2xl border border-border/60 bg-background/70 p-4">
                <div className="font-semibold">Interactive buttons</div>
                <input value={buttonMessage} onChange={(event) => setButtonMessage(event.target.value)} className={inputClassName} placeholder="Button message" />
                <input value={buttonFooter} onChange={(event) => setButtonFooter(event.target.value)} className={inputClassName} placeholder="Footer" />
                {buttonLabels.map((label, index) => (
                  <input
                    key={index}
                    value={label}
                    onChange={(event) => setButtonLabels((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                    className={inputClassName}
                    placeholder={`Button ${index + 1}`}
                  />
                ))}
                <button type="submit" className={secondaryButtonClassName}>Send buttons</button>
              </form>
            </div>
          </PlaygroundCard>

          <PlaygroundCard title="Logs, events, and docs" icon={MessageSquareIcon}>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button type="button" onClick={loadSelectedActivity} className={secondaryButtonClassName}>Load logs/events</button>
              <a href={workerLinks.docsUrl || undefined} target="_blank" rel="noopener noreferrer" className={linkButtonClassName} aria-disabled={!workerLinks.docsUrl}>
                <BookOpenIcon className="h-4 w-4" />
                Worker docs
              </a>
              <a href={workerLinks.openApiUrl || undefined} target="_blank" rel="noopener noreferrer" className={linkButtonClassName} aria-disabled={!workerLinks.openApiUrl}>
                <FileCodeIcon className="h-4 w-4" />
                OpenAPI
              </a>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <MiniFeed title="Recent messages" items={(activity?.messages ?? []).slice(0, 5).map((item) => `${item.direction} ${item.phone || "unknown"}: ${item.body || ""}`)} />
              <MiniFeed title="Recent events" items={(activity?.logs ?? []).slice(0, 5).map((item) => `${item.severity} ${item.event_type}: ${item.summary || ""}`)} />
            </div>
          </PlaygroundCard>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-6">
          <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Response</h2>
                <p className="text-sm text-muted-foreground">{busyAction ? `Running ${busyAction}...` : "Latest action output"}</p>
              </div>
              {busyAction && <RefreshCwIcon className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <pre className="max-h-[560px] overflow-auto rounded-2xl border border-border/60 bg-black/70 p-4 text-xs leading-5 text-emerald-100">
              {responseText}
            </pre>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((open) => !open)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="font-semibold">Advanced worker access</span>
              <ExternalLinkIcon className="h-4 w-4 text-muted-foreground" />
            </button>
            {advancedOpen && (
              <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                <div className="rounded-xl bg-muted/40 p-3 font-mono text-xs text-foreground">
                  {workerBaseUrl || "Worker base URL pending"}
                </div>
                <p>
                  The legacy worker `/test` console is still available for advanced direct API testing and requires an org key from Connection.
                </p>
                <a href={workerLinks.playgroundUrl || undefined} target="_blank" rel="noopener noreferrer" className={linkButtonClassName} aria-disabled={!workerLinks.playgroundUrl}>
                  Open worker /test
                </a>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: typeof ServerIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className={cn("mt-3 truncate text-2xl font-semibold tracking-tight", tone === "ok" && "text-emerald-600 dark:text-emerald-300", tone === "warn" && "text-amber-600 dark:text-amber-300")}>
        {value}
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function PlaygroundCard({ title, icon: Icon, children }: { title: string; icon: typeof ServerIcon; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function MiniFeed({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
      <div className="mb-3 font-semibold">{title}</div>
      <div className="space-y-2">
        {items.length ? items.map((item, index) => (
          <div key={`${title}-${index}`} className="truncate rounded-lg bg-muted/35 px-3 py-2 text-sm text-muted-foreground">
            {item}
          </div>
        )) : (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
            No recent rows.
          </div>
        )}
      </div>
    </div>
  );
}

function formatResponse(label: string, payload: unknown) {
  return JSON.stringify({ label, payload: redactSecrets(payload) }, null, 2);
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      /apiKey|api_key|authorization|token|secret|password/i.test(key) ? "[redacted]" : redactSecrets(item),
    ]),
  );
}

const inputClassName = "h-11 w-full rounded-xl border border-border/60 bg-background px-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground/60";
const primaryButtonClassName = "inline-flex h-11 items-center justify-center rounded-xl bg-foreground px-4 text-sm font-semibold text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName = "inline-flex h-11 items-center justify-center rounded-xl border border-border/60 bg-background px-4 text-sm font-semibold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60";
const linkButtonClassName = "inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-border/60 bg-background px-4 text-sm font-semibold transition hover:bg-muted aria-disabled:pointer-events-none aria-disabled:opacity-50";
