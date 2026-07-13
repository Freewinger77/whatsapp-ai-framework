import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  KeyRoundIcon,
  LinkIcon,
  MessageCircleIcon,
  QrCodeIcon,
  XIcon,
} from "lucide-react";
import {
  getQrExpiresInMs,
  type InstancePairingClient,
  waitForPairingQr,
} from "@/polymet/lib/pairing-api";
import { cn } from "@/lib/utils";

type ConnectMode = "menu" | "qr" | "pairing" | "clear";

type InstanceConnectPanelProps = {
  instanceId: string;
  instanceName?: string;
  connected: boolean;
  client: InstancePairingClient;
  onConnected: () => void;
  onClose?: () => void;
  layout?: "modal" | "page";
};

export function InstanceConnectPanel({
  instanceId,
  instanceName,
  connected,
  client,
  onConnected,
  onClose,
  layout = "modal",
}: InstanceConnectPanelProps) {
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
      await client.connect();
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
        const latest = (await client.getQr()).worker;
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
              if (!cancelled) setLoading(false);
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
  }, [client, instanceId, mode, onConnected]);

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
      const qr = await waitForPairingQr(client);
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
      const response = await client.connect({ pairingPhone: phone });
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
      await client.clearAuth();
      setAuthCleared(true);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Could not clear saved auth.");
    } finally {
      setLoading(false);
    }
  };

  const panel = (
    <div
      className={cn(
        layout === "modal"
          ? "relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl animate-pop-in sm:rounded-3xl"
          : "mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-xl",
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border/60 p-4 sm:p-6">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">WhatsApp pairing</p>
          <h2 className="mt-1 text-xl font-semibold">
            {instanceName ? `Connect ${instanceName}` : "Connect WhatsApp"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scan a QR code, use an 8-digit pairing code, or clear saved auth before pairing again.
          </p>
        </div>
        {onClose ? (
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Close">
            <XIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 overflow-y-auto p-4 sm:p-6 md:grid-cols-[260px_minmax(0,1fr)] md:gap-5">
        <div className="space-y-3">
          <ActionTile active={mode === "qr"} icon={QrCodeIcon} title="QR code" body="Scan from WhatsApp linked devices." onClick={showQr} />
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
                Pick QR for fastest setup, or use a pairing code if scanning is not convenient.
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
                  <p className="mt-3 text-xs text-muted-foreground">
                    Keep WhatsApp open while the link finishes. A fresh QR will appear automatically if this attempt times out.
                  </p>
                </div>
              )}
              {!loading && qrCode && (
                <>
                  <img
                    src={qrCode}
                    alt="WhatsApp pairing QR code"
                    className="mx-auto h-48 w-48 rounded-2xl border border-border bg-white p-3 shadow-inner sm:h-56 sm:w-56"
                  />
                  <p className="mt-4 text-sm text-muted-foreground">
                    Open WhatsApp → Linked devices → Link a device, then scan this code.
                  </p>
                  {(qrUpdatedAt || qrVersion > 0) && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      QR v{qrVersion || 1}
                      {typeof qrExpiresInMs === "number" ? ` · refreshes in ${Math.ceil(qrExpiresInMs / 1000)}s` : ""}
                      {qrRefreshRestartCount > 0 ? ` · restarts ${qrRefreshRestartCount}` : ""}
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
                    <div className="font-mono text-3xl font-semibold tracking-[0.24em] sm:text-4xl sm:tracking-[0.35em]">
                      {pairingCode}
                    </div>
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
                <p className="text-sm text-muted-foreground">Use clear auth to reset pairing credentials.</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (layout === "page") {
    return panel;
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex h-dvh w-screen items-center justify-center bg-black/45 p-3 backdrop-blur-sm animate-fade-in sm:p-4">
      {panel}
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

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
      {message}
    </div>
  );
}

export function createAuthenticatedPairingClient(instanceId: string): InstancePairingClient {
  return {
    connect: async (input = {}) => {
      const { connectInstance } = await import("@/polymet/lib/control-plane-api");
      return connectInstance(instanceId, input);
    },
    getQr: async () => {
      const { getInstanceQr } = await import("@/polymet/lib/control-plane-api");
      return getInstanceQr(instanceId);
    },
    clearAuth: async () => {
      const { clearInstanceAuth } = await import("@/polymet/lib/control-plane-api");
      return clearInstanceAuth(instanceId);
    },
  };
}
