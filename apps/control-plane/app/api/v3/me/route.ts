import { NextResponse } from 'next/server';
import { getWasupPrincipal } from '../../../../lib/auth';

export async function GET() {
  const principal = await getWasupPrincipal();
  return NextResponse.json({
    success: !!principal,
    auth: principal?.source ?? 'none',
    principal,
    upgradePath: 'Clerk is active; replace the dev org fallback with strict Clerk organizations when ready.'
  });
}
