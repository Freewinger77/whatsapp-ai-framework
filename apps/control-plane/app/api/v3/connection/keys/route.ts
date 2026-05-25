import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateApiKey, maskApiKey } from '../../../../../lib/api-keys';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { recordAppNotification } from '../../../../../lib/notifications';
import { getOrgPlanAccess } from '../../../../../lib/plan-access';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const RotateKeySchema = z.object({
  keyKind: z.enum(['live', 'test']),
  name: z.string().min(1).max(120).optional()
});

const ACTIVE_DEPLOYMENT_STATUSES = new Set(['not_started', 'queued', 'provisioning', 'dns_pending']);

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = RotateKeySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const plan = await getOrgPlanAccess(principal.orgId);
  if (!plan.canViewCredentials) {
    return NextResponse.json(
      { error: 'Upgrade to Wasup Pro to manage API keys and connection credentials.' },
      { status: 402 }
    );
  }

  const supabase = getSupabaseAdmin() as any;
  const now = new Date().toISOString();

  const { data: deployment, error: deploymentError } = await supabase
    .from('org_deployments')
    .select('status')
    .eq('org_id', principal.orgId)
    .eq('environment', 'production')
    .maybeSingle();

  if (deploymentError) {
    return NextResponse.json({ error: deploymentError.message }, { status: 500 });
  }

  if (!deployment || ACTIVE_DEPLOYMENT_STATUSES.has(String(deployment.status))) {
    return NextResponse.json(
      { error: 'API key actions are unavailable until workspace provisioning is ready.' },
      { status: 409 }
    );
  }

  await supabase
    .from('api_keys')
    .update({ revoked_at: now })
    .eq('org_id', principal.orgId)
    .eq('key_kind', body.keyKind)
    .is('revoked_at', null);

  const generated = generateApiKey(body.keyKind);
  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      org_id: principal.orgId,
      name: body.name || (body.keyKind === 'live' ? 'Live API key' : 'Test API key'),
      public_id: generated.publicId,
      secret_hash: generated.secretHash,
      salt: generated.salt,
      key_kind: body.keyKind,
      scopes: defaultOrgApiKeyScopes(body.keyKind),
      created_by: principal.actorId
    })
    .select('id, name, public_id, key_kind, scopes, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await recordAppNotification({
    orgId: principal.orgId,
    eventType: 'api_key.rotated',
    kind: 'security',
    severity: 'info',
    title: 'API key rotated',
    body: `${body.keyKind === 'live' ? 'Live' : 'Test'} API key was rotated.`,
    idempotencyKey: `in-app:api-key-rotated:${data.id}`,
    metadata: {
      apiKeyId: data.id,
      keyKind: data.key_kind,
      publicId: data.public_id,
      masked: maskApiKey(data.public_id),
      actorId: principal.actorId
    }
  });

  return NextResponse.json({
    success: true,
    apiKey: {
      ...data,
      masked: maskApiKey(data.public_id)
    },
    secret: generated.key,
    message: 'Store this key now. It will not be shown again.'
  }, { status: 201 });
}

function defaultOrgApiKeyScopes(keyKind: 'live' | 'test') {
  const sharedScopes = ['instances:read', 'instances:write', 'messages:send'];
  return keyKind === 'live' ? [...sharedScopes, 'webhooks:manage'] : sharedScopes;
}
