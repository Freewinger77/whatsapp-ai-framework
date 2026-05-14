import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateApiKey } from '../../../../lib/api-keys';
import { getWasupPrincipal, isAuthError, requireWasupPrincipal } from '../../../../lib/auth';
import { getSupabaseAdmin } from '../../../../lib/supabase-admin';

const CreateOrgSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  name: z.string().min(1).max(160),
  plan: z.string().min(1).max(64).default('starter'),
  regionPreference: z.string().min(2).max(32).optional(),
  createApiKey: z.boolean().default(true)
});

export async function GET() {
  const principal = await getWasupPrincipal();
  const supabase = getSupabaseAdmin() as any;

  const { data, error } = await supabase
    .from('organizations')
    .select('id, slug, name, plan, status, region_preference, api_base_url, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message, fallbackOrg: principal }, { status: 500 });
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

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      slug: body.slug,
      name: body.name,
      plan: body.plan,
      region_preference: body.regionPreference ?? null,
      api_base_url: `https://api.wasup.ai/v3/orgs/${body.slug}`
    })
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let apiKey: string | null = null;
  if (body.createApiKey) {
    const generated = generateApiKey();
    apiKey = generated.key;
    await supabase.from('api_keys').insert({
      org_id: org.id,
      name: 'Default API key',
      public_id: generated.publicId,
      secret_hash: generated.secretHash,
      salt: generated.salt,
      scopes: ['instances:read', 'instances:write', 'messages:send', 'webhooks:manage'],
      created_by: principal.actorId
    });
  }

  await supabase.from('audit_events').insert({
    org_id: org.id,
    actor_clerk_user_id: principal.actorId,
    action: 'organization.created',
    target_type: 'organization',
    target_id: org.id,
    metadata: { placeholderAuth: true }
  });

  return NextResponse.json({ success: true, organization: org, apiKey }, { status: 201 });
}
