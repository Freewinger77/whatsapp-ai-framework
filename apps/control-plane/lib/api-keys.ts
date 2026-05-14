import crypto from 'crypto';

const KEY_PREFIX = 'wsp_v3';
const SECRET_BYTES = 32;

export type GeneratedApiKey = {
  key: string;
  publicId: string;
  secret: string;
  salt: string;
  secretHash: string;
};

export function generateApiKey(pepper = process.env.WASUP_API_KEY_PEPPER || ''): GeneratedApiKey {
  const publicId = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const salt = crypto.randomBytes(16).toString('hex');
  const secretHash = hashApiKeySecret(secret, salt, pepper);

  return {
    key: `${KEY_PREFIX}_${publicId}_${secret}`,
    publicId,
    secret,
    salt,
    secretHash
  };
}

export function parseApiKey(key: string) {
  const [prefix, version, publicId, secret] = key.split('_');
  if (`${prefix}_${version}` !== KEY_PREFIX || !publicId || !secret) {
    return null;
  }
  return { publicId, secret };
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
