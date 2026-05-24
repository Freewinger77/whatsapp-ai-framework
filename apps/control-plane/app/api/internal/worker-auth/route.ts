import { NextResponse } from 'next/server';
import { z } from 'zod';
import { constantTimeEqual, hashApiKeySecret, parseApiKey } from '../../../../lib/api-keys';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const ValidateWorkerKeySchema = z.object({
  apiKey: z.string().min(1),
  hostname: z.string().min(1),
  requiredScope: z.string().min(1).optional()
});

export async function POST(req: Request) {
  const requiredSecret = process.env.WASUP_WORKER_SHARED_SECRET;
  const suppliedSecret = req.headers.get('x-wasup-worker-secret') || '';

  if (!requiredSecret || suppliedSecret !== requiredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedBody = ValidateWorkerKeySchema.safeParse(await req.json());
  if (!parsedBody.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const parsedKey = parseApiKey(parsedBody.data.apiKey);
  if (!parsedKey) {
    return NextResponse.json(
      { valid: false, reason: 'invalid_format', message: publicIdOnlyMessage(parsedBody.data.apiKey) },
      { status: 200 }
    );
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: key, error } = await supabase
    .from('api_keys')
    .select('id, org_id, public_id, secret_hash, salt, key_kind, scopes, expires_at, revoked_at')
    .eq('public_id', parsedKey.publicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!key || key.revoked_at) {
    return NextResponse.json({ valid: false, reason: 'not_found' }, { status: 200 });
  }

  if (!['live', 'test'].includes(String(key.key_kind))) {
    return NextResponse.json({ valid: false, reason: 'unsupported_key_kind' }, { status: 200 });
  }

  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ valid: false, reason: 'expired' }, { status: 200 });
  }

  const expectedHash = hashApiKeySecret(parsedKey.secret, key.salt);
  if (!constantTimeEqual(expectedHash, key.secret_hash)) {
    return NextResponse.json({ valid: false, reason: 'invalid_secret' }, { status: 200 });
  }

  const scopes = Array.isArray(key.scopes) ? key.scopes.map(String) : [];
  if (!hasRequiredScope(scopes, parsedBody.data.requiredScope)) {
    return NextResponse.json({ valid: false, reason: 'scope_denied' }, { status: 200 });
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name, api_base_url')
    .eq('id', key.org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ valid: false, reason: 'org_not_found' }, { status: 200 });
  }

  const { data: deployment, error: deploymentError } = await supabase
    .from('org_deployments')
    .select('base_url, fqdn')
    .eq('org_id', key.org_id)
    .eq('environment', 'production')
    .maybeSingle();

  if (deploymentError) {
    return NextResponse.json({ error: deploymentError.message }, { status: 500 });
  }

  if (!hostMatchesOrg(parsedBody.data.hostname, org.api_base_url, deployment?.base_url, deployment?.fqdn)) {
    return NextResponse.json({ valid: false, reason: 'hostname_mismatch' }, { status: 200 });
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return NextResponse.json({
    valid: true,
    orgId: org.id,
    orgSlug: org.slug,
    keyKind: key.key_kind,
    publicId: key.public_id,
    scopes
  });
}

function hasRequiredScope(scopes: string[], requiredScope?: string) {
  if (!requiredScope || scopes.length === 0) return true;
  return scopes.includes(requiredScope);
}

function hostMatchesOrg(hostname: string, ...allowedValues: Array<string | null | undefined>) {
  const requested = normalizeHost(hostname);
  if (!requested) return false;

  return allowedValues.some((value) => normalizeHost(value) === requested);
}

function normalizeHost(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname;
  } catch {
    return raw.split('/')[0].split(':')[0];
  }
}

function publicIdOnlyMessage(value: string) {
  return /^sk-(?:prod|dev)-[a-f0-9]{16}$/i.test(value.trim())
    ? 'This is a public key ID. Rotate the key in the Connection page and copy the one-time full secret.'
    : 'Invalid API key format.';
}
