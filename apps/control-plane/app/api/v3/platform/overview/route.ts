import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { fetchPlatformOverview } from '../../../../../lib/platform-overview';
import { requirePlatformAdmin } from '../../../../../lib/platform-admin';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const platformAdmin = await requirePlatformAdmin();
  if (!platformAdmin.allowed) {
    return NextResponse.json({ error: 'Platform admin required' }, { status: 403 });
  }

  try {
    const overview = await fetchPlatformOverview();
    return NextResponse.json({ success: true, ...overview });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not load platform overview' },
      { status: 500 }
    );
  }
}
