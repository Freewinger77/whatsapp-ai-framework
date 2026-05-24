import crypto from 'crypto';

const KEY_PREFIX = 'wsp_v3';
const KEY_KIND_PREFIXES = {
  live: 'sk-prod',
  test: 'sk-dev'
} as const;
const SECRET_BYTES = 32;

export type CustomerApiKeyKind = keyof typeof KEY_KIND_PREFIXES;

export type GeneratedApiKey = {
  key: string;
  publicId: string;
  secret: string;
  salt: string;
  secretHash: string;
};

export function generateApiKey(kind?: CustomerApiKeyKind, pepper = process.env.WASUP_API_KEY_PEPPER || ''): GeneratedApiKey {
  const publicId = buildPublicId(kind);
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const secretHash = hashApiKeySecret(secret, salt, pepper);

  return {
    key: formatApiKey(publicId, secret),
    publicId,
    secret,
    salt,
    secretHash
  };
}

export function parseApiKey(key: string) {
  const modern = key.match(/^(sk-(?:prod|dev)-[a-f0-9]{16})-(.+)$/);
  if (modern?.[1] && modern[2]) {
    return { publicId: modern[1], secret: modern[2] };
  }

  const [prefix, version, publicId, ...secretParts] = key.split('_');
  const secret = secretParts.join('_');
  if (`${prefix}_${version}` !== KEY_PREFIX || !publicId || !secret) {
    return null;
  }
  return { publicId, secret };
}

export function maskApiKey(publicId: string) {
  return publicId.startsWith('sk-') ? `${publicId}-...` : `${KEY_PREFIX}_${publicId}_...`;
}

export function hashApiKeySecret(secret: string, salt: string, pepper = process.env.WASUP_API_KEY_PEPPER || '') {
  return crypto
    .createHmac('sha256', pepper || 'wasup-v3-dev-pepper')
    .update(`${salt}:${secret}`)
    .digest('hex');
}

export function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function buildPublicId(kind?: CustomerApiKeyKind) {
  const id = crypto.randomBytes(8).toString('hex');
  return kind ? `${KEY_KIND_PREFIXES[kind]}-${id}` : id;
}

function formatApiKey(publicId: string, secret: string) {
  return publicId.startsWith('sk-') ? `${publicId}-${secret}` : `${KEY_PREFIX}_${publicId}_${secret}`;
}
