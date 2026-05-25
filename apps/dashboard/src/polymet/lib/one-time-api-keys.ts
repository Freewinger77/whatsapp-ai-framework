export type OneTimeApiKey = {
  id: string;
  public_id: string;
  key_kind: "live" | "test";
  secret: string;
};

const STORAGE_PREFIX = "wasup.oneTimeApiKeys";

export function storeOneTimeApiKeys(orgId: string, keys: OneTimeApiKey[] | undefined) {
  if (typeof window === "undefined" || !orgId || !keys?.length) return;

  const existingById = new Map(loadOneTimeApiKeys(orgId).map((key) => [key.id, key]));
  for (const key of keys) {
    if (isOneTimeApiKey(key)) existingById.set(key.id, key);
  }
  window.sessionStorage.setItem(storageKey(orgId), JSON.stringify(Array.from(existingById.values())));
}

export function storeOneTimeApiKey(orgId: string, key: OneTimeApiKey | undefined) {
  if (!key) return;
  storeOneTimeApiKeys(orgId, [key]);
}

export function loadOneTimeApiKeys(orgId: string) {
  if (typeof window === "undefined" || !orgId) return [];

  const key = storageKey(orgId);
  const raw = window.sessionStorage.getItem(key);

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOneTimeApiKey) : [];
  } catch {
    return [];
  }
}

export function consumeOneTimeApiKeys(orgId: string) {
  return loadOneTimeApiKeys(orgId);
}

function storageKey(orgId: string) {
  return `${STORAGE_PREFIX}.${orgId}`;
}

function isOneTimeApiKey(value: unknown): value is OneTimeApiKey {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<OneTimeApiKey>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.public_id === "string" &&
    (candidate.key_kind === "live" || candidate.key_kind === "test") &&
    typeof candidate.secret === "string" &&
    !candidate.secret.includes("...")
  );
}
