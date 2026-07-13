const API_BASE = import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL || "";

export type PairingWorkerQr = {
  status: string;
  qrCode: string | null;
  pairingCode: string | null;
  qrCodeUpdatedAt?: string | null;
  qrVersion?: number;
  qrAgeMs?: number | null;
  qrTtlMs?: number | null;
  qrExpiresInMs?: number | null;
  qrRefreshRestartCount?: number;
  staleProtocolResetCount?: number;
  qrScanReceivedAt?: string | null;
  linkingGraceUntil?: string | null;
  linkingGraceActive?: boolean;
  lastCredsUpdateAt?: string | null;
  message?: string;
  phone?: string;
  connectionIssue?: {
    message?: string;
    requiresAuthClear?: boolean;
  } | null;
};

export type PublicPairingInstance = {
  id: string;
  name: string;
  status: string;
  phone: string | null;
};

class PairingApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "PairingApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function publicApi<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Pairing-Token", token);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = payload as { error?: string; message?: string } | null;
    throw new PairingApiError(
      errorPayload?.error || errorPayload?.message || `Request failed: ${response.status}`,
      response.status,
      payload,
    );
  }
  return payload as T;
}

export async function getPublicPairingInstance(instanceId: string, token: string) {
  return publicApi<{ success: boolean; instance: PublicPairingInstance }>(
    `/api/v3/public/pair/${instanceId}?token=${encodeURIComponent(token)}`,
    token,
  );
}

export async function publicPairConnect(instanceId: string, token: string, input: { pairingPhone?: string } = {}) {
  return publicApi<{
    worker: {
      pairingCode?: string | null;
      instance?: { status?: string; pairingCode?: string | null };
    };
  }>(`/api/v3/public/pair/${instanceId}/connect`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function publicPairGetQr(instanceId: string, token: string) {
  return publicApi<{ worker: PairingWorkerQr }>(
    `/api/v3/public/pair/${instanceId}/qr?_=${Date.now()}`,
    token,
  );
}

export async function publicPairClearAuth(instanceId: string, token: string) {
  return publicApi<{ worker: unknown }>(`/api/v3/public/pair/${instanceId}/clear-auth`, token, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type InstancePairingClient = {
  connect: (input?: { pairingPhone?: string }) => Promise<{
    worker: {
      pairingCode?: string | null;
      instance?: { status?: string; pairingCode?: string | null };
    };
  }>;
  getQr: () => Promise<{ worker: PairingWorkerQr }>;
  clearAuth: () => Promise<{ worker: unknown }>;
};

export function createPublicPairingClient(instanceId: string, token: string): InstancePairingClient {
  return {
    connect: (input = {}) => publicPairConnect(instanceId, token, input),
    getQr: () => publicPairGetQr(instanceId, token),
    clearAuth: () => publicPairClearAuth(instanceId, token),
  };
}

export const QR_DISPLAY_TTL_MS = 110_000;

export function getQrExpiresInMs(updatedAt?: string | null, workerExpiresInMs?: number | null) {
  if (typeof workerExpiresInMs === "number" && Number.isFinite(workerExpiresInMs)) {
    return workerExpiresInMs;
  }
  if (!updatedAt) return null;
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return null;
  return Math.max(0, QR_DISPLAY_TTL_MS - (Date.now() - updatedMs));
}

export async function waitForPairingQr(client: InstancePairingClient) {
  let latest = await client.getQr();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (latest.worker.qrCode || latest.worker.status === "connected") return latest.worker;
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    latest = await client.getQr();
  }
  return latest.worker;
}
