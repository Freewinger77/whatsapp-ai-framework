import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { constantTimeEqual, hashApiKeySecret, parseApiKey } from './api-keys';
import { getPlaceholderPrincipal } from './placeholder-auth';
import { getSupabaseAdmin } from './supabase-admin';

export type WasupPrincipal = {
  actorId: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
  orgId: string;
  orgSlug: string;
  orgName: string;
  source: 'clerk' | 'placeholder' | 'api_key';
  apiKey?: {
    id: string;
    publicId: string;
    keyKind: 'live' | 'test';
    scopes: string[];
  };
};

type RequireWasupPrincipalOptions = {
  allowApiKey?: boolean;
  requiredScope?: string | string[];
};

export async function getWasupPrincipal(): Promise<WasupPrincipal | null> {
  const session = await auth();
  const userId = session.userId;

  if (userId) {
    return resolveClerkPrincipal({
      userId,
      clerkOrgId: session.orgId,
      clerkOrgSlug: session.orgSlug,
      clerkOrgRole: session.orgRole
    });
  }

  if (isDevAuthFallbackEnabled() && !process.env.CLERK_SECRET_KEY) {
    return { ...getPlaceholderPrincipal(), source: 'placeholder' };
  }

  return null;
}

export async function requireWasupPrincipal(
  req?: Request,
  options: RequireWasupPrincipalOptions = {}
): Promise<WasupPrincipal | NextResponse> {
  const principal = await getWasupPrincipal();
  if (principal) return principal;

  if (options.allowApiKey && req) {
    const apiKeyPrincipal = await resolveApiKeyPrincipal(req, options.requiredScope);
    if (apiKeyPrincipal) return apiKeyPrincipal;
  }

  const requiredToken = process.env.WASUP_DEV_ADMIN_TOKEN;
  const supplied = req?.headers.get('x-wasup-admin-token') || '';
  if (isDevAuthFallbackEnabled() && requiredToken && supplied === requiredToken) {
    return { ...getPlaceholderPrincipal(), source: 'placeholder' };
  }

  return NextResponse.json(
    { error: 'Unauthorized', message: 'No Wasup organization is linked to this Clerk session.' },
    { status: 401 }
  );
}

export function isAuthError(value: WasupPrincipal | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

export async function getClerkUserEmail(userId: string): Promise<string | null> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    return user.primaryEmailAddress?.emailAddress || user.emailAddresses[0]?.emailAddress || null;
  } catch {
    return null;
  }
}

export async function getAuthenticatedClerkEmail(userId?: string | null): Promise<string | null> {
  const session = await auth();
  const claims = session.sessionClaims as Record<string, unknown> | null | undefined;
  const claimEmail =
    stringClaim(claims?.email) ||
    stringClaim(claims?.primary_email_address) ||
    stringClaim(claims?.primaryEmailAddress);

  if (claimEmail) return claimEmail;

  const activeUser = await currentUser();
  const currentUserEmail =
    activeUser?.primaryEmailAddress?.emailAddress || activeUser?.emailAddresses?.[0]?.emailAddress || null;
  if (currentUserEmail) return currentUserEmail;

  if (userId || session.userId) {
    return getClerkUserEmail(userId || session.userId!);
  }

  return null;
}

function stringClaim(value: unknown) {
  return typeof value === 'string' && value.includes('@') ? value.trim() : '';
}

function mapClerkRole(role: string | null | undefined): WasupPrincipal['role'] {
  if (role?.includes('owner')) return 'owner';
  if (role?.includes('admin')) return 'admin';
  if (role?.includes('viewer')) return 'viewer';
  return 'operator';
}

async function resolveApiKeyPrincipal(
  req: Request,
  requiredScope: RequireWasupPrincipalOptions['requiredScope']
): Promise<WasupPrincipal | NextResponse | null> {
  const credential = getApiKeyCredential(req);
  if (!credential) return null;

  const parsed = parseApiKey(credential);
  if (!parsed) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Invalid API key format.' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin() as any;
  const { data: key, error } = await supabase
    .from('api_keys')
    .select('id, org_id, public_id, secret_hash, salt, key_kind, scopes, expires_at, revoked_at')
    .eq('public_id', parsed.publicId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!key || key.revoked_at) {
    return NextResponse.json({ error: 'Unauthorized', message: 'API key was not found.' }, { status: 401 });
  }

  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Unauthorized', message: 'API key has expired.' }, { status: 401 });
  }

  const expectedHash = hashApiKeySecret(parsed.secret, key.salt);
  if (!constantTimeEqual(expectedHash, key.secret_hash)) {
    return NextResponse.json({ error: 'Unauthorized', message: 'API key secret is invalid.' }, { status: 401 });
  }

  const scopes = Array.isArray(key.scopes) ? key.scopes.map(String) : [];
  if (!hasRequiredScope(scopes, requiredScope)) {
    return NextResponse.json({ error: 'Forbidden', message: 'API key scope is not allowed for this endpoint.' }, { status: 403 });
  }

  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, slug, name')
    .eq('id', key.org_id)
    .single();

  if (orgError || !org) {
    return NextResponse.json({ error: orgError?.message || 'Organization not found' }, { status: 401 });
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return {
    actorId: `api_key:${key.public_id}`,
    role: 'operator',
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    source: 'api_key',
    apiKey: {
      id: key.id,
      publicId: key.public_id,
      keyKind: key.key_kind,
      scopes
    }
  };
}

function getApiKeyCredential(req: Request) {
  const xApiKey = req.headers.get('x-api-key')?.trim();
  if (xApiKey) return xApiKey;

  const authorization = req.headers.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function hasRequiredScope(scopes: string[], requiredScope: RequireWasupPrincipalOptions['requiredScope']) {
  if (!requiredScope || scopes.length === 0) return true;
  const required = Array.isArray(requiredScope) ? requiredScope : [requiredScope];
  return required.some((scope) => scopes.includes(scope));
}

async function resolveClerkPrincipal(input: {
  userId: string;
  clerkOrgId: string | null | undefined;
  clerkOrgSlug: string | null | undefined;
  clerkOrgRole: string | null | undefined;
}): Promise<WasupPrincipal | null> {
  if (isDevAuthFallbackEnabled() && process.env.WASUP_DEV_ORG_ID) {
    return {
      actorId: input.userId,
      role: mapClerkRole(input.clerkOrgRole),
      orgId: process.env.WASUP_DEV_ORG_ID,
      orgSlug: process.env.WASUP_DEV_ORG_SLUG || input.clerkOrgSlug || 'local-dev',
      orgName: process.env.WASUP_DEV_ORG_NAME || input.clerkOrgSlug || 'Local development',
      source: 'clerk'
    };
  }

  const supabase = getSupabaseAdmin() as any;

  if (input.clerkOrgId) {
    const { data: org, error } = await supabase
      .from('organizations')
      .select('id, slug, name')
      .eq('clerk_org_id', input.clerkOrgId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (org) {
      await upsertMembership(supabase, org.id, input.userId, mapClerkRole(input.clerkOrgRole));
      return {
        actorId: input.userId,
        role: mapClerkRole(input.clerkOrgRole),
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
        source: 'clerk'
      };
    }
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('role, organizations(id, slug, name)')
    .eq('clerk_user_id', input.userId)
    .limit(1)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);
  const org = Array.isArray(membership?.organizations)
    ? membership.organizations[0]
    : membership?.organizations;

  if (!org) {
    const createdOrg = await createClerkBackedOrg(supabase, input);
    return {
      actorId: input.userId,
      role: mapClerkRole(input.clerkOrgRole) === 'viewer' ? 'viewer' : 'owner',
      orgId: createdOrg.id,
      orgSlug: createdOrg.slug,
      orgName: createdOrg.name,
      source: 'clerk'
    };
  }

  return {
    actorId: input.userId,
    role: membership.role || mapClerkRole(input.clerkOrgRole),
    orgId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    source: 'clerk'
  };
}

function isDevAuthFallbackEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.WASUP_ENABLE_DEV_AUTH_FALLBACK === 'true';
}

async function createClerkBackedOrg(
  supabase: any,
  input: {
    userId: string;
    clerkOrgId: string | null | undefined;
    clerkOrgSlug: string | null | undefined;
    clerkOrgRole: string | null | undefined;
  }
) {
  const { data: existingMembership, error: existingMembershipError } = await supabase
    .from('organization_members')
    .select('role, organizations(id, slug, name)')
    .eq('clerk_user_id', input.userId)
    .limit(1)
    .maybeSingle();

  if (existingMembershipError) throw new Error(existingMembershipError.message);

  const existingOrg = Array.isArray(existingMembership?.organizations)
    ? existingMembership.organizations[0]
    : existingMembership?.organizations;

  if (existingOrg) {
    return existingOrg;
  }

  const clerkOrgDetails = await resolveClerkOrganizationDetails(input.clerkOrgId);
  const slugSource =
    clerkOrgDetails?.name || input.clerkOrgSlug || input.clerkOrgId || input.userId;
  const slug = buildWorkspaceSlug(slugSource);
  const name =
    clerkOrgDetails?.name ||
    (input.clerkOrgSlug ? titleize(input.clerkOrgSlug) : 'Workspace');

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({
      clerk_org_id: input.clerkOrgId ?? null,
      slug,
      name
    })
    .select('id, slug, name')
    .single();

  if (error) {
    const { data: existingOrg, error: lookupError } = input.clerkOrgId
      ? await supabase
          .from('organizations')
          .select('id, slug, name')
          .eq('clerk_org_id', input.clerkOrgId)
          .maybeSingle()
      : await supabase
          .from('organizations')
          .select('id, slug, name')
          .eq('slug', slug)
          .maybeSingle();

    if (lookupError || !existingOrg) throw new Error(error.message);
    await upsertMembership(supabase, existingOrg.id, input.userId, mapClerkRole(input.clerkOrgRole) === 'viewer' ? 'viewer' : 'owner');
    return existingOrg;
  }

  await upsertMembership(supabase, org.id, input.userId, mapClerkRole(input.clerkOrgRole) === 'viewer' ? 'viewer' : 'owner');
  return org;
}

async function resolveClerkOrganizationDetails(clerkOrgId: string | null | undefined) {
  if (!clerkOrgId) return null;

  try {
    const clerk = await clerkClient();
    const organization = await clerk.organizations.getOrganization({ organizationId: clerkOrgId });
    const name = organization.name?.trim();
    if (!name) return null;
    return { name };
  } catch {
    return null;
  }
}

async function upsertMembership(
  supabase: any,
  orgId: string,
  userId: string,
  role: WasupPrincipal['role']
) {
  const { error } = await supabase
    .from('organization_members')
    .upsert(
      {
        org_id: orgId,
        clerk_user_id: userId,
        role
      },
      { onConflict: 'org_id,clerk_user_id' }
    );

  if (error) throw new Error(error.message);
}

function buildWorkspaceSlug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/^org_/, '')
    .replace(/^user_/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const suffix = shortStableSuffix(value);
  const base = normalized.length >= 2 ? normalized : 'workspace';
  return `${base}-${suffix}`.slice(0, 63);
}

function shortStableSuffix(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 8);
}

function titleize(value: string) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim() || 'Workspace';
}
