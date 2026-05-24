import { NextResponse } from 'next/server';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getProxyAvailability } from '../../../../../lib/proxy-pool';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const regionCode = url.searchParams.get('regionCode') || undefined;
  const availability = await getProxyAvailability(regionCode);

  return NextResponse.json({ success: true, availability });
}
