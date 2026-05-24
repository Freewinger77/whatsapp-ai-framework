import type { ControlPlaneConnection } from "@/polymet/lib/control-plane-api";

export const WORKER_DOCS_PATH = "/docs";
export const WORKER_PLAYGROUND_PATH = "/test";
export const WORKER_OPENAPI_PATH = "/api/openapi.yaml";

export function getWorkerBaseUrl(connection: ControlPlaneConnection) {
  return normalizeBaseUrl(connection.deployment.base_url || connection.organization.baseUrl || "");
}

export function getWorkerLinks(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);

  return {
    docsUrl: normalized ? `${normalized}${WORKER_DOCS_PATH}` : "",
    playgroundUrl: normalized ? `${normalized}${WORKER_PLAYGROUND_PATH}` : "",
    openApiUrl: normalized ? `${normalized}${WORKER_OPENAPI_PATH}` : "",
  };
}

export function isWorkerReady(connection: ControlPlaneConnection) {
  return connection.deployment.status === "ready" && Boolean(getWorkerBaseUrl(connection));
}

function normalizeBaseUrl(value: string | null | undefined) {
  return String(value || "").trim().replace(/\/+$/, "");
}
