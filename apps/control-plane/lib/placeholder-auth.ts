import { NextResponse } from 'next/server';

export type PlaceholderPrincipal = {
  actorId: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer';
  orgId: string;
  orgSlug: string;
  orgName: string;
};

const DEV_ORG_ID = '00000000-0000-4000-8000-000000000001';

export function getPlaceholderPrincipal(): PlaceholderPrincipal {
  return {
    actorId: 'dev-admin',
    role: 'owner',
    orgId: process.env.WASUP_DEV_ORG_ID || DEV_ORG_ID,
    orgSlug: process.env.WASUP_DEV_ORG_SLUG || 'demo',
    orgName: process.env.WASUP_DEV_ORG_NAME || 'Demo Organisation'
  };
}

export function requirePlaceholderAdmin(req: Request): PlaceholderPrincipal | NextResponse {
  const requiredToken = process.env.WASUP_DEV_ADMIN_TOKEN;

  if (requiredToken) {
    const supplied = req.headers.get('x-wasup-admin-token') || '';
    if (supplied !== requiredToken) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Missing or invalid X-Wasup-Admin-Token' },
        { status: 401 }
      );
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Set WASUP_DEV_ADMIN_TOKEN in production' },
      { status: 401 }
    );
  }

  return getPlaceholderPrincipal();
}

export function isAuthError(value: PlaceholderPrincipal | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
