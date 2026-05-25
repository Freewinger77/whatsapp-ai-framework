import type { ControlPlaneConnection } from "@/polymet/lib/control-plane-api";

const CONTROL_PLANE_API_BASE =
  (import.meta.env.VITE_CONTROL_PLANE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://control-plane.wasup.co";

export const WORKER_DOCS_PATH = "/docs";
export const WORKER_PLAYGROUND_PATH = "/test";
export const WORKER_OPENAPI_PATH = "/openapi.yaml";
export const WORKER_ADMIN_PATH = "/";
export const CONTROL_PLANE_V3_DOCS_PATH = "/v3-docs.html";
export const CONTROL_PLANE_V3_OPENAPI_PATH = "/openapi-v3.yaml";

export const WORKER_CAPABILITIES = [
  "Plain text and link previews",
  "Quick reply buttons",
  "CTA URL buttons",
  "Message reactions",
  "Dynamic OpenAPI server URL",
] as const;

export function getWorkerBaseUrl(connection: ControlPlaneConnection) {
  return normalizeBaseUrl(connection.deployment.base_url || connection.organization.baseUrl || "");
}

export function getWorkerLinks(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);

  return {
    baseUrl: normalized,
    docsUrl: normalized ? `${normalized}${WORKER_DOCS_PATH}` : "",
    playgroundUrl: normalized ? `${normalized}${WORKER_PLAYGROUND_PATH}` : "",
    openApiUrl: normalized ? `${normalized}${WORKER_OPENAPI_PATH}` : "",
    adminUrl: normalized ? `${normalized}${WORKER_ADMIN_PATH}` : "",
    controlPlaneDocsUrl: `${CONTROL_PLANE_API_BASE}${CONTROL_PLANE_V3_DOCS_PATH}`,
    controlPlaneOpenApiUrl: `${CONTROL_PLANE_API_BASE}${CONTROL_PLANE_V3_OPENAPI_PATH}`,
  };
}

export function isWorkerReady(connection: ControlPlaneConnection) {
  return connection.deployment.status === "ready" && Boolean(getWorkerBaseUrl(connection));
}

function normalizeBaseUrl(value: string | null | undefined) {
  return String(value || "").trim().replace(/\/+$/, "");
}
