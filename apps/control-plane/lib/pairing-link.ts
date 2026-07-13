import { createHmac, timingSafeEqual } from 'crypto';

export type PairingLinkPayload = {
  instanceId: string;
  orgId: string;
  exp: number;
  iat: number;
};

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function pairingSecret() {
  return (
    process.env.WASUP_PAIRING_LINK_SECRET?.trim() ||
    process.env.WASUP_WORKER_SHARED_SECRET?.trim() ||
    ''
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payloadB64: string, secret: string) {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function createPairingLinkToken(
  input: { instanceId: string; orgId: string; ttlSeconds?: number },
  secret = pairingSecret()
) {
  if (!secret) {
    throw new Error('Pairing link signing secret is not configured.');
  }

  const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? DEFAULT_TTL_SECONDS, 60), 30 * 24 * 60 * 60);
  const iat = Math.floor(Date.now() / 1000);
  const payload: PairingLinkPayload = {
    instanceId: input.instanceId,
    orgId: input.orgId,
    iat,
    exp: iat + ttlSeconds
  };
  const payloadB64 = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadB64, secret);
  return {
    token: `${payloadB64}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

export function verifyPairingLinkToken(token: string, expectedInstanceId: string, secret = pairingSecret()) {
  if (!secret) {
    return { ok: false as const, error: 'Pairing links are not configured on this server.' };
  }

  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0) {
    return { ok: false as const, error: 'Invalid pairing link.' };
  }

  const payloadB64 = trimmed.slice(0, dot);
  const signature = trimmed.slice(dot + 1);
  const expectedSignature = signPayload(payloadB64, secret);

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false as const, error: 'Invalid pairing link.' };
  }

  let payload: PairingLinkPayload;
  try {
    payload = JSON.parse(decodeBase64Url(payloadB64)) as PairingLinkPayload;
  } catch {
    return { ok: false as const, error: 'Invalid pairing link.' };
  }

  if (!payload?.instanceId || !payload?.orgId || !payload?.exp) {
    return { ok: false as const, error: 'Invalid pairing link.' };
  }

  if (payload.instanceId !== expectedInstanceId) {
    return { ok: false as const, error: 'This pairing link does not match this instance.' };
  }

  if (payload.exp * 1000 <= Date.now()) {
    return { ok: false as const, error: 'This pairing link has expired. Ask your Wasup admin for a new link.' };
  }

  return { ok: true as const, payload };
}

export function buildPairingLinkUrl(instanceId: string, token: string) {
  const base = (process.env.WASUP_DASHBOARD_URL || 'https://dev.wasup.co').replace(/\/+$/, '');
  const url = new URL(base);
  url.hash = `/pair/${instanceId}?token=${encodeURIComponent(token)}`;
  return url.toString();
}

export function readPairingTokenFromRequest(req: Request) {
  const header = req.headers.get('x-pairing-token')?.trim();
  if (header) return header;

  try {
    const url = new URL(req.url);
    const queryToken = url.searchParams.get('token')?.trim();
    if (queryToken) return queryToken;
  } catch {
    // ignore
  }

  return '';
}
