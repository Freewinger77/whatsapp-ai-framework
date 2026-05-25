import type { Instance } from "@/polymet/data/dashboard-data";
import { instancePhoneLabel } from "@/polymet/lib/instance-status";
import type { OneTimeApiKey } from "@/polymet/lib/one-time-api-keys";

const API_BASE = import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL || "";

type ClerkGetToken = () => Promise<string | null>;

let clerkGetToken: ClerkGetToken | null = null;

export function setControlPlaneAuthTokenGetter(getToken: ClerkGetToken | null) {
  clerkGetToken = getToken;
}

export type WorkspacePlan = {
  tier: "free" | "pro" | "grace" | "locked";
  isPro: boolean;
  canCreateInstances: boolean;
  canViewCredentials: boolean;
  proInstanceLimit: number;
  billingStatus: string | null;
  billingGraceEndsAt: string | null;
  billingLockedAt: string | null;
  trialEndsAt?: string | null;
  instancesDeleteAfter?: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activeInstanceCount: number;
  paidInstanceLimit: number;
  availableInstanceSlots: number;
};

export type ControlPlaneConnection = {
  credentialsLocked?: boolean;
  plan?: WorkspacePlan;
  organization: {
    id: string;
    slug: string;
    name: string;
    baseUrl: string | null;
  };
  deployment: {
    id: string;
    status: string;
    base_url: string | null;
    public_ip: string | null;
    last_error: string | null;
    requested_at: string | null;
    provisioned_at: string | null;
    dns_ready_at: string | null;
    progress: {
      stage: string;
      label: string;
      message: string;
      estimate: string | null;
      detail: string | null;
    };
  };
  apiKeys: Array<{
    id: string;
    name: string;
    public_id: string;
    key_kind: "live" | "test";
    masked: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>;
  oneTimeApiKeys?: OneTimeApiKey[];
};

export type DeepDiveResult = {
  logs: Array<{
    id: string;
    instance_id: string | null;
    event_type: string;
    severity: string;
    summary: string | null;
    created_at: string;
  }>;
  messages: Array<{
    id: string;
    instance_id: string | null;
    direction: "inbound" | "outbound";
    phone: string | null;
    body: string | null;
    status: string;
    created_at: string;
  }>;
};

export type PlaygroundWorkerHealth = {
  success: boolean;
  connection: {
    baseUrl: string | null;
    status: string;
  };
  worker: {
    reachable: boolean;
    status?: number;
    endpoint?: string;
    body?: unknown;
    error?: string;
  };
};

export type BillingEntitlementsResult = {
  billing: {
    billing_status: string;
    paid_instance_limit: number;
    reserved_instance_count: number;
    active_instance_count: number;
    available_instance_slots: number;
    message_credit_balance?: number;
    current_period_end?: string | null;
    cancel_at_period_end?: boolean;
  };
  plan: WorkspacePlan;
  entitlement: {
    allowed: boolean;
    mode: "billing" | "trial" | "free" | "grace";
    reason: string | null;
    availableSlots: number;
    paidInstanceLimit: number;
    activeInstanceCount: number;
    reservedInstanceCount: number;
    trialInstanceLimit: number | null;
    trialEndsAt: string | null;
  };
};

export type NotificationEvent = {
  id: string;
  eventType: string;
  title: string;
  body: string;
  level: "info" | "warn" | "success";
  kind?: string;
  status: string;
  provider: string;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
  metadata: Record<string, unknown>;
};

export type InviteOrganizationMemberResult = {
  success: boolean;
  redirectUrl: string;
  invitation: {
    id: string;
    emailAddress: string;
    role: string;
    status?: string;
  };
};

export type PlatformOrgRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  orgStatus: string;
  clerkOrgId: string | null;
  apiBaseUrl: string | null;
  subdomain: string | null;
  deploymentStatus: string | null;
  createdAt: string;
  tier: WorkspacePlan["tier"];
  billingStatus: string | null;
  billingGraceEndsAt: string | null;
  billingLockedAt: string | null;
  trialEndsAt: string | null;
  instancesDeleteAfter: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  activeInstanceCount: number;
  paidInstanceLimit: number;
  availableInstanceSlots: number;
  messageCreditBalance: number;
  deployment: {
    status: string;
    baseUrl: string | null;
    publicIp: string | null;
    vmName: string | null;
    azureRegion: string | null;
    azureResourceGroup: string | null;
    vmSize: string | null;
    vmCostUsd: number;
    lastError: string | null;
    requestedAt: string | null;
    provisionedAt: string | null;
    dnsReadyAt: string | null;
  } | null;
  instanceCounts: {
    total: number;
    connected: number;
    disconnected: number;
    provisioning: number;
    error: number;
    suspended: number;
  };
};

export type PlatformInstanceRow = {
  id: string;
  orgId: string;
  orgSlug: string;
  orgName: string;
  name: string;
  status: string;
  regionCode: string;
  phone: string | null;
  provisioningState: string | null;
  createdAt: string;
};

export type PlatformProxyRow = {
  id: string;
  label: string | null;
  regionCode: string;
  host: string;
  port: number;
  status: string;
  instanceId: string | null;
  instanceName: string | null;
  orgId: string | null;
  orgSlug: string | null;
  orgName: string | null;
  assignedAt: string | null;
};

export type PlatformOverview = {
  generatedAt: string;
  summary: {
    totalOrganizations: number;
    proOrganizations: number;
    trialingOrganizations: number;
    graceOrganizations: number;
    lockedOrganizations: number;
    blockedOrganizations: number;
    freeOrganizations: number;
    totalInstances: number;
    connectedInstances: number;
    readyDeployments: number;
    failedDeployments: number;
    proxyTotal: number;
    proxyFree: number;
    proxyAssigned: number;
    totalVmCostUsd: number;
  };
  organizations: PlatformOrgRow[];
  instances: PlatformInstanceRow[];
  proxies: PlatformProxyRow[];
  proxyPool: Array<{
    regionCode: string;
    total: number;
    free: number;
    assigned: number;
    unavailable: number;
  }>;
};

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export async function listInstances(): Promise<Instance[]> {
  const payload = await api<{ instances: ControlPlaneInstance[] }>("/api/v3/instances");
  return payload.instances.map(mapInstance);
}

export async function getInstance(id: string): Promise<Instance> {
  const payload = await api<{ instance: ControlPlaneInstance }>(`/api/v3/instances/${id}`);
  return mapInstance(payload.instance);
}

export async function getConnection(): Promise<ControlPlaneConnection> {
  return api<ControlPlaneConnection>("/api/v3/connection");
}

export async function updateInstanceSettings(id: string, input: {
  name?: string;
  webhookUrl?: string | null;
  webhookSigningSecret?: string | null;
}) {
  const payload = await api<{ instance: ControlPlaneInstance }>(`/api/v3/instances/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
  return mapInstance(payload.instance);
}

export async function inviteOrganizationMember(input: {
  emailAddress: string;
  role: "org:admin" | "org:member" | "org:viewer";
}) {
  return api<InviteOrganizationMemberResult>("/api/v3/organization-invitations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getBillingEntitlements(): Promise<BillingEntitlementsResult> {
  return api<BillingEntitlementsResult>("/api/v3/billing/entitlements");
}

export async function createBillingCheckout(input: {
  instanceQuantity?: number;
  messageCreditQuantity?: number;
  successUrl?: string;
  cancelUrl?: string;
  contactEmail?: string;
}) {
  return api<{ success: boolean; checkoutUrl: string; sessionId: string }>("/api/v3/billing/checkout", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function syncBillingEntitlements(input: { checkoutSessionId?: string } = {}) {
  return api<{ success: boolean; subscriptionId: string; plan: WorkspacePlan }>("/api/v3/billing/sync", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createBillingPortalSession(input: { returnUrl?: string } = {}) {
  return api<{ success: boolean; portalUrl: string }>("/api/v3/billing/portal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function rotateApiKey(keyKind: "live" | "test") {
  return api<{
    secret: string;
    apiKey: {
      id: string;
      public_id: string;
      key_kind: "live" | "test";
      masked: string;
    };
  }>("/api/v3/connection/keys", {
    method: "POST",
    body: JSON.stringify({ keyKind }),
  });
}

export async function listNotifications() {
  return api<{ notifications: NotificationEvent[]; unreadCount: number }>("/api/v3/notifications");
}

export async function markNotificationsRead(input: { ids?: string[]; all?: boolean }) {
  return api<{ success: boolean; updated?: number }>("/api/v3/notifications/mark-read", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createInstance(input: {
  name: string;
  region: string;
  webhookUrl?: string;
}) {
  return api<{ instance: ControlPlaneInstance; deployment: unknown; proxy: unknown; worker: unknown }>(
    "/api/v3/provision/instances",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        regionCode: regionLabelToCode(input.region),
        webhookUrl: input.webhookUrl || undefined,
      }),
    },
  );
}

export async function connectInstance(id: string, input: { pairingPhone?: string } = {}) {
  return api<{
    worker: {
      pairingCode?: string | null;
      instance?: { status?: string; pairingCode?: string | null };
    };
  }>(`/api/v3/instances/${id}/connect`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getInstanceQr(id: string) {
  return api<{
    worker: {
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
  }>(`/api/v3/instances/${id}/qr?_=${Date.now()}`, { cache: "no-store" });
}

export async function clearInstanceAuth(id: string) {
  return api<{ worker: unknown }>(`/api/v3/instances/${id}/clear-auth`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function sendInstanceMessage(
  id: string,
  input: {
    to: string;
    message?: string;
    text?: string;
    buttons?: Array<{ id: string; text: string }>;
    footer?: string;
    typingSimulation?: boolean;
    delayEnabled?: boolean;
  },
) {
  return api<{ success: boolean; worker: unknown }>(`/api/v3/instances/${id}/send`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteInstance(id: string) {
  return api<{ success: boolean; worker: unknown }>(`/api/v3/instances/${id}`, {
    method: "DELETE",
  });
}

export async function resetCustomerWorkspace(input: { confirmation: "DELETE" }) {
  return api<{
    success: boolean;
    organization: { id: string; slug: string; name: string };
    instancesDeleted: number;
    vmDeprovisioning: unknown;
    warnings: Array<{ step: string; targetId?: string; message: string }>;
    orgScopedRows: Array<{ table: string; deleted: number | null }>;
    accountDeletion: {
      organizationDeleted: boolean;
      userDeleted: boolean;
      reason?: string;
    };
  }>("/api/v3/customer/reset", {
    method: "DELETE",
    body: JSON.stringify(input),
  });
}

export async function getProxyAvailability() {
  return api<{
    availability: Array<{ region_code: string; total: number; free: number; assigned: number; unavailable: number }>;
  }>("/api/v3/proxy/availability");
}

export async function getPlatformOverview() {
  return api<PlatformOverview>("/api/v3/platform/overview", { cache: "no-store" });
}

export async function blockPlatformOrganization(orgId: string, reason?: string) {
  return api<{ success: boolean; status: string }>(`/api/v3/platform/orgs/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "block", reason }),
  });
}

export async function unblockPlatformOrganization(orgId: string) {
  return api<{ success: boolean; status: string }>(`/api/v3/platform/orgs/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "unblock" }),
  });
}

export async function deletePlatformOrganization(orgId: string) {
  return api<{ success: boolean; instancesReleased: number }>(`/api/v3/platform/orgs/${encodeURIComponent(orgId)}`, {
    method: "DELETE",
  });
}

export async function deletePlatformOrganizationVm(orgId: string) {
  return api<{ success: boolean }>(`/api/v3/platform/orgs/${encodeURIComponent(orgId)}?scope=vm`, {
    method: "DELETE",
  });
}

export type PlatformProxyPoolItem = {
  id: string;
  label: string | null;
  region_code: string;
  host: string;
  port: number;
  proxy_type: string;
  source: string;
  status: string;
  assigned_at: string | null;
  instance_id: string | null;
  org_id: string | null;
  instance_name: string | null;
  org_slug: string | null;
  org_name: string | null;
  credential: "configured" | "none";
};

export async function listProxyPool(regionCode?: string) {
  const search = new URLSearchParams();
  if (regionCode) search.set("regionCode", regionCode);
  return api<{ proxies: PlatformProxyPoolItem[] }>(`/api/v3/proxy/admin${search.size ? `?${search.toString()}` : ""}`);
}

export async function removeProxyFromPool(proxyId: string, force = false) {
  return api<{ success: boolean }>("/api/v3/proxy/admin", {
    method: "DELETE",
    body: JSON.stringify({ id: proxyId, force }),
  });
}

export async function importProxyPool(input: {
  regionCode: string;
  proxies: string;
  providerName?: string;
  labelPrefix?: string;
}) {
  return api<{
    imported: number;
    parseErrors: Array<{ line: number; error: string }>;
  }>("/api/v3/proxy/admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getDeepDive(params: {
  type: "messages" | "logs" | "all";
  instanceId?: string;
  search?: string;
  from?: string;
  to?: string;
}) {
  const search = new URLSearchParams();
  search.set("type", params.type);
  if (params.instanceId && params.instanceId !== "all") search.set("instanceId", params.instanceId);
  if (params.search) search.set("search", params.search);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  return api<DeepDiveResult>(`/api/v3/deep-dive?${search.toString()}`);
}

export async function getPlaygroundWorkerHealth() {
  return api<PlaygroundWorkerHealth>("/api/v3/playground/worker-health", { cache: "no-store" });
}

export type InstanceMediaItem = {
  id: string;
  instanceId?: string;
  mediaType?: string;
  direction?: string;
  mimeType?: string | null;
  fileName?: string | null;
  publicUrl?: string | null;
  size?: number;
  createdAt?: string;
  downloadUrl?: string | null;
};

export async function listInstanceMedia(
  instanceId: string,
  params: { type?: string; limit?: number } = {},
) {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.limit) search.set("limit", String(params.limit));
  const query = search.size ? `?${search.toString()}` : "";
  return api<{ success: boolean; count: number; media: InstanceMediaItem[] }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/media${query}`,
    { cache: "no-store" },
  );
}

export async function fetchInstanceMediaBlob(instanceId: string, mediaId: string) {
  const response = await apiRaw(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/media/${encodeURIComponent(mediaId)}`,
  );
  return response.blob();
}

export function instanceMediaPreviewUrl(instanceId: string, mediaId: string) {
  return `${API_BASE}/api/v3/instances/${encodeURIComponent(instanceId)}/media/${encodeURIComponent(mediaId)}`;
}

export type AntibanV2Status = {
  enabled?: boolean;
  running?: boolean;
  preset?: string;
  health?: { risk?: string; isPaused?: boolean; recommendation?: string } | null;
  warmup?: {
    phase?: string;
    day?: number;
    totalDays?: number;
    todayLimit?: number;
    todaySent?: number;
    progress?: number;
    complete?: boolean;
  } | null;
  rateLimiter?: {
    lastHour?: number;
    lastDay?: number;
    limits?: {
      perHour?: number;
      perDay?: number;
      maxPerHour?: number;
      maxPerDay?: number;
    };
  } | null;
  config?: {
    overrides?: { maxPerHour?: number; maxPerDay?: number };
    modules?: Record<string, { enabled?: boolean; day1Limit?: number }>;
  };
};

function normalizeAntibanV2Status(raw: unknown): AntibanV2Status | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.antibanV2 && typeof record.antibanV2 === "object") {
    return normalizeAntibanV2Status(record.antibanV2);
  }
  return raw as AntibanV2Status;
}

function readRateLimitHour(status: AntibanV2Status | null) {
  return status?.rateLimiter?.limits?.maxPerHour
    ?? status?.rateLimiter?.limits?.perHour
    ?? status?.config?.overrides?.maxPerHour;
}

function readRateLimitDay(status: AntibanV2Status | null) {
  return status?.rateLimiter?.limits?.maxPerDay
    ?? status?.rateLimiter?.limits?.perDay
    ?? status?.config?.overrides?.maxPerDay;
}

export async function getInstanceAntibanV2(instanceId: string) {
  const payload = await api<{ success: boolean; antibanV2?: unknown }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/antiban-v2`,
    { cache: "no-store" },
  );
  return normalizeAntibanV2Status(payload.antibanV2);
}

export async function updateInstanceAntibanV2(
  instanceId: string,
  body: {
    preset?: "conservative" | "moderate" | "aggressive" | "balanced";
    overrides?: { maxPerHour?: number; maxPerDay?: number };
    modules?: { warmup?: { enabled?: boolean; day1Limit?: number } };
  },
) {
  return api<{ success: boolean; antibanV2?: AntibanV2Status }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/antiban-v2/config`,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export async function graduateInstanceWarmup(instanceId: string) {
  return api<{ success: boolean; antibanV2?: AntibanV2Status }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/antiban-v2/warmup`,
    { method: "POST", body: JSON.stringify({ action: "graduate" }) },
  );
}

export async function pauseInstanceAntibanV2(instanceId: string) {
  return api<{ success: boolean; antibanV2?: AntibanV2Status }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/antiban-v2/pause`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export async function resumeInstanceAntibanV2(instanceId: string) {
  return api<{ success: boolean; antibanV2?: AntibanV2Status }>(
    `/api/v3/instances/${encodeURIComponent(instanceId)}/antiban-v2/resume`,
    { method: "POST", body: JSON.stringify({}) },
  );
}

export function regionLabelToCode(region: string) {
  const map: Record<string, string> = {
    Finland: "fi",
    Sweden: "se",
    "UK South": "uk-south",
    "UK West": "uk-west",
    Germany: "de",
    France: "fr",
    Italy: "it",
    Norway: "no",
  };
  return map[region] || region.toLowerCase().replace(/\s+/g, "-");
}

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

function mapInstance(instance: ControlPlaneInstance): Instance {
  const proxy = instance.proxy_allocations?.[0];
  const lastError = typeof instance.metadata?.last_error === "string" ? instance.metadata.last_error : undefined;
  const status = mapStatus(instance.status);
  const messagesToday = typeof instance.messages_today === "number" ? instance.messages_today : 0;
  return {
    id: instance.id,
    name: instance.name,
    region: codeToRegionLabel(instance.region_code),
    status,
    phone: instancePhoneLabel({ status, phone: instance.phone || "" }),
    webhookUrl: instance.webhook_url || "",
    behaviorProfile: mapBehavior(instance.behavior_profile),
    proxy: proxy ? `${proxy.region_code}-${proxy.host}:${proxy.port}` : "No proxy assigned",
    messagesToday: formatCount(messagesToday),
    uptime: instance.status === "connected" ? "Live" : instance.status === "disconnected" ? "Disconnected" : "Pending",
    qualityScore: instance.status === "error" ? "Critical" : "Healthy",
    provisioningState: instance.provisioning_state,
    lastError,
  };
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = await clerkGetToken?.();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = payload as { error?: string; message?: string } | null;
    throw new ApiError(errorPayload?.error || errorPayload?.message || `Request failed: ${response.status}`, response.status, payload);
  }
  return payload;
}

async function apiRaw(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = await clerkGetToken?.();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const errorPayload = payload as { error?: string; message?: string } | null;
    throw new ApiError(
      errorPayload?.error || errorPayload?.message || `Request failed: ${response.status}`,
      response.status,
      payload,
    );
  }

  return response;
}

function codeToRegionLabel(code: string) {
  const map: Record<string, string> = {
    fi: "Finland",
    se: "Sweden",
    "uk-south": "UK South",
    "uk-west": "UK West",
    de: "Germany",
    fr: "France",
    it: "Italy",
    no: "Norway",
    northeurope: "North Europe",
  };
  return map[code] || code;
}

function mapStatus(status: string): Instance["status"] {
  if (status === "connected") return "active";
  if (status === "disconnected") return "offline";
  if (status === "connecting") return "connecting";
  if (status === "error" || status === "suspended") return "quality-warning";
  if (status === "provisioning") return "provisioning";
  return "offline";
}

function mapBehavior(value: string): Instance["behaviorProfile"] {
  if (value === "bot-native") return "Bot-native";
  if (value === "notification-max") return "Notification max";
  return "Notification balanced";
}

type ControlPlaneInstance = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  messages_today?: number;
  provisioning_state?: string;
  metadata?: Record<string, unknown> | null;
  region_code: string;
  webhook_url: string | null;
  behavior_profile: string;
  proxy_allocations?: Array<{
    region_code: string;
    host: string;
    port: number;
  }>;
};
