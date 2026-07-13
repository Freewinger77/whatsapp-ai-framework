import { useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { InstanceConnectPanel } from "@/polymet/components/instance-connect-panel";
import { createPublicPairingClient, getPublicPairingInstance } from "@/polymet/lib/pairing-api";

function readPairRouteInstanceId() {
  const hash = window.location.hash.replace(/^#/, "");
  const route = hash.split("?")[0];
  if (!route.startsWith("/pair/")) return "";
  return route.slice("/pair/".length).split("/")[0] || "";
}

function readPairingTokenFromHash() {
  const queryStart = window.location.hash.indexOf("?");
  if (queryStart === -1) return "";
  return new URLSearchParams(window.location.hash.slice(queryStart + 1)).get("token")?.trim() || "";
}

export default function PublicPairPage() {
  const instanceId = useMemo(() => readPairRouteInstanceId(), []);
  const token = useMemo(() => readPairingTokenFromHash(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [connected, setConnected] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!instanceId || !token) {
      setError("This pairing link is incomplete. Ask your Wasup admin to send a fresh link.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    void getPublicPairingInstance(instanceId, token)
      .then((response) => {
        if (cancelled) return;
        setInstanceName(response.instance.name);
        setConnected(response.instance.status === "connected");
        setPhone(response.instance.phone);
        setLoading(false);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "Could not open this pairing link.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [instanceId, token]);

  const client = useMemo(() => {
    if (!instanceId || !token) return null;
    return createPublicPairingClient(instanceId, token);
  }, [instanceId, token]);

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,230,118,0.12),transparent_42%),radial-gradient(circle_at_80%_100%,rgba(0,213,255,0.08),transparent_38%)]" />
      <div className="relative mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 py-8 sm:px-6 sm:py-10">
        <header className="mb-6 text-center sm:mb-8">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">Wasup onboarding</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Connect your WhatsApp number</h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Your admin prepared this secure link so you can pair WhatsApp without signing into the full dashboard.
          </p>
        </header>

        {loading ? (
          <div className="mx-auto w-full max-w-xl rounded-2xl border border-border/70 bg-card px-6 py-10 text-center text-sm text-muted-foreground shadow-xl">
            Opening pairing session...
          </div>
        ) : error ? (
          <div className="mx-auto w-full max-w-xl rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : client ? (
          <div className="space-y-4">
            <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              <span className="rounded-full border border-border/70 bg-card px-3 py-1">{instanceName}</span>
              {connected ? (
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300">
                  Connected{phone ? ` · ${phone}` : ""}
                </span>
              ) : (
                <span className="rounded-full border border-border/70 bg-card px-3 py-1">Waiting to pair</span>
              )}
            </div>
            <InstanceConnectPanel
              instanceId={instanceId}
              instanceName={instanceName}
              connected={connected}
              client={client}
              layout="page"
              onConnected={() => {
                setConnected(true);
                void getPublicPairingInstance(instanceId, token)
                  .then((response) => setPhone(response.instance.phone))
                  .catch(() => undefined);
              }}
            />
          </div>
        ) : null}
      </div>
      <Toaster closeButton richColors position="top-center" />
    </main>
  );
}
