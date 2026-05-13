import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getPlaceholderPrincipal } from './placeholder-auth';

export type WasupPrincipal = {
  actorId: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
  orgId: string;
  orgSlug: string;
  orgName: string;
  source: 'clerk' | 'placeholder';
};

export async function getWasupPrincipal(): Promise<WasupPrincipal | null> {
  const session = await auth();
  const userId = session.userId;

  if (userId) {
    const orgId = session.orgId || process.env.WASUP_DEV_ORG_ID || getPlaceholderPrincipal().orgId;
    return {
      actorId: userId,
      role: mapClerkRole(session.orgRole),
      orgId,
      orgSlug: session.orgSlug || process.env.WASUP_DEV_ORG_SLUG || 'demo',
      orgName: process.env.WASUP_DEV_ORG_NAME || session.orgSlug || 'Clerk Organisation',
      source: 'clerk'
    };
  }

  if (process.env.NODE_ENV !== 'production' && !process.env.CLERK_SECRET_KEY) {
    return { ...getPlaceholderPrincipal(), source: 'placeholder' };
  }

  return null;
}

export async function requireWasupPrincipal(req?: Request): Promise<WasupPrincipal | NextResponse> {
  const principal = await getWasupPrincipal();
  if (principal) return principal;

  const requiredToken = process.env.WASUP_DEV_ADMIN_TOKEN;
  const supplied = req?.headers.get('x-wasup-admin-token') || '';
  if (requiredToken && supplied === requiredToken) {
    return { ...getPlaceholderPrincipal(), source: 'placeholder' };
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function isAuthError(value: WasupPrincipal | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

function mapClerkRole(role: string | null | undefined): WasupPrincipal['role'] {
  if (role?.includes('owner')) return 'owner';
  if (role?.includes('admin')) return 'admin';
  if (role?.includes('viewer')) return 'viewer';
  return 'operator';
}
