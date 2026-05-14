import { NextResponse } from 'next/server';
import { getOrgBillingSummary } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';

export async function GET(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const url = new URL(req.url);
  const orgId = url.searchParams.get('orgId') || principal.orgId;
  const summary = await getOrgBillingSummary(orgId);

  return NextResponse.json({ success: true, billing: summary });
}
