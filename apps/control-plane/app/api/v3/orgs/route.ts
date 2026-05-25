import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateApiKey } from '../../../../lib/api-keys';
import { isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getServerEnv } from '../../../../lib/env';
import { requirePlatformAdmin } from '../../../../lib/platform-admin';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const CreateOrgSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(160),
  plan: z.string().min(1).max(64).default('starter'),
  regionPreference: z.string().min(2).max(32).optional(),
  createApiKey: z.boolean().default(true)
});

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin() as any;

  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, plan, status, region_preference, api_base_url, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, organizations: data ?? [] });
}

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = CreateOrgSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const supabase = getSupabaseAdmin() as any;
  const env = getServerEnv();

  const { data: existingMembership, error: membershipError } = await supabase
    .from('organization_members')
    .select('org_id')
    .eq('clerk_user_id', principal.actorId)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }

  if (existingMembership?.org_id) {
    return NextResponse.json(
      { error: 'This account already owns a Wasup workspace. One workspace per user.' },
      { status: 409 }
    );
  }

  const subdomain = body.slug;
  const apiBaseUrl = `https://${subdomain}.${env.WASUP_BASE_DOMAIN}`;

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      slug: body.slug,
      name: body.name,
      plan: body.plan,
      region_preference: body.regionPreference ?? null,
      api_base_url: apiBaseUrl,
      subdomain
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const apiKeys: Array<{ id: string; kind: 'live' | 'test'; publicId: string; key: string }> = [];
  if (body.createApiKey) {
    for (const kind of ['live', 'test'] as const) {
      const generated = generateApiKey(kind);
      const { data: keyRow, error: keyError } = await supabase
        .from('api_keys')
        .insert({
          org_id: org.id,
          name: kind === 'live' ? 'Live API key' : 'Test API key',
          public_id: generated.publicId,
          secret_hash: generated.secretHash,
          salt: generated.salt,
          key_kind: kind,
          scopes: defaultOrgApiKeyScopes(kind),
          created_by: principal.actorId
        })
        .select('id, public_id')
        .single();

      if (keyError) {
        return NextResponse.json({ error: keyError.message }, { status: 500 });
      }

      apiKeys.push({
        id: keyRow.id,
        kind,
        publicId: keyRow.public_id,
        key: generated.key
      });
    }
  }

  await supabase.from('audit_events').insert({
    org_id: org.id,
    actor_clerk_user_id: principal.actorId,
    action: 'organization.created',
    target_type: 'organization',
    target_id: org.id,
    metadata: { placeholderAuth: true }
  });

  return NextResponse.json({ success: true, organization: org, apiKeys }, { status: 201 });
}

function defaultOrgApiKeyScopes(keyKind: 'live' | 'test') {
  const sharedScopes = ['instances:read', 'instances:write', 'messages:send'];
  return keyKind === 'live' ? [...sharedScopes, 'webhooks:manage'] : sharedScopes;
}
