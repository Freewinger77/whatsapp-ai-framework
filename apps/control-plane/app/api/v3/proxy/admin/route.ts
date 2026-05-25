import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { requirePlatformAdmin } from '../../../../../lib/platform-admin';
import { parseProxyBulk } from '../../../../../lib/proxy-import';
import { removeProxyFromPool } from '../../../../../lib/platform-admin-ops';
import { getSupabaseAdmin } from '../../../../../lib/supabase-admin';

const ImportProxySchema = z.object({
  regionCode: z.string().min(2).max(32),
  proxies: z.string().min(3),
  providerName: z.string().min(1).max(120).default('Webshare'),
  labelPrefix: z.string().max(80).optional()
});

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const url = new URL(req.url);
  const regionCode = url.searchParams.get('regionCode');
  let query = (getSupabaseAdmin() as any)
    .from('proxy_allocations')
    .select(
      'id, label, region_code, host, port, proxy_type, source, status, assigned_at, released_at, last_verified_at, instance_id, org_id, instances(name), organizations(slug, name)'
    )
    .order('created_at', { ascending: false });

  if (regionCode) query = query.eq('region_code', regionCode);

  const { data, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    proxies: (data ?? []).map(redactProxy)
  });
}

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const parsed = ImportProxySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const supabase = getSupabaseAdmin() as any;
  const { data: region } = await supabase
    .from('regions')
    .select('code, label, status')
    .eq('code', body.regionCode)
    .single();

  if (!region || region.status !== 'available') {
    return NextResponse.json({ error: `Region ${body.regionCode} is not available` }, { status: 400 });
  }

  const { data: provider, error: providerError } = await supabase
    .from('proxy_providers')
    .upsert({
      name: body.providerName,
      kind: 'imported-pool',
      status: 'active',
      supported_regions: [body.regionCode],
      updated_at: new Date().toISOString()
    }, { onConflict: 'name' })
    .select('id')
    .single();

  if (providerError) {
    return NextResponse.json({ error: providerError.message }, { status: 500 });
  }

  const parsedBulk = parseProxyBulk(body.proxies);
  if (!parsedBulk.proxies.length) {
    return NextResponse.json({ error: 'No valid proxy lines found', parseErrors: parsedBulk.errors }, { status: 400 });
  }

  const rows = parsedBulk.proxies.map((proxy, index) => ({
    provider_id: provider.id,
    region_code: body.regionCode,
    host: proxy.host,
    port: proxy.port,
    proxy_type: proxy.type,
    source: 'imported-pool',
    status: 'free',
    label: body.labelPrefix ? `${body.labelPrefix}-${index + 1}` : `${body.providerName}-${body.regionCode}-${index + 1}`,
    username_ref: proxy.username ? `inline:${proxy.username}` : null,
    password_secret_ref: proxy.password ? 'inline-redacted' : null,
    username_encrypted: proxy.username ?? null,
    password_encrypted: proxy.password ?? null,
    health: {
      importedBy: principal.actorId,
      importedAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  }));

  const { data, error } = await supabase
    .from('proxy_allocations')
    .upsert(rows, { onConflict: 'region_code,host,port' })
    .select('id, label, region_code, host, port, proxy_type, source, status, assigned_at, released_at, last_verified_at, instance_id, org_id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    imported: data?.length ?? 0,
    parseErrors: parsedBulk.errors,
    proxies: (data ?? []).map(redactProxy)
  }, { status: 201 });
}

const DeleteProxySchema = z.object({
  id: z.string().uuid(),
  force: z.boolean().optional()
});

export async function DELETE(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;
  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  const parsed = DeleteProxySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await removeProxyFromPool(parsed.data.id, principal.actorId, parsed.data.force);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not remove proxy' },
      { status: 400 }
    );
  }
}

function redactProxy(proxy: any) {
  const instance = Array.isArray(proxy.instances) ? proxy.instances[0] : proxy.instances;
  const organization = Array.isArray(proxy.organizations) ? proxy.organizations[0] : proxy.organizations;
  return {
    id: proxy.id,
    label: proxy.label,
    region_code: proxy.region_code,
    host: proxy.host,
    port: proxy.port,
    proxy_type: proxy.proxy_type,
    source: proxy.source,
    status: proxy.status,
    assigned_at: proxy.assigned_at,
    released_at: proxy.released_at,
    last_verified_at: proxy.last_verified_at,
    instance_id: proxy.instance_id,
    org_id: proxy.org_id,
    instance_name: instance?.name ?? null,
    org_slug: organization?.slug ?? null,
    org_name: organization?.name ?? null,
    credential: proxy.username_ref ? 'configured' : 'none'
  };
}
