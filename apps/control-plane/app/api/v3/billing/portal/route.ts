import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureStripeCustomerForOrg } from '../../../../../lib/billing';
import { getAuthenticatedClerkEmail, isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getStripe, getWasupAppUrl } from '../../../../../lib/stripe';

const PortalSchema = z.object({
  orgId: z.string().uuid().optional(),
  returnUrl: z.string().url().optional()
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = PortalSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const orgId = parsed.data.orgId || principal.orgId;
  if (orgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let contactEmail: string | null = null;
  if (principal.source === 'clerk') {
    contactEmail = await getAuthenticatedClerkEmail(principal.actorId);
  }

  const customer = await ensureStripeCustomerForOrg(orgId, contactEmail);
  const appUrl = getWasupAppUrl(req);
  const session = await getStripe().billingPortal.sessions.create({
    customer,
    return_url: parsed.data.returnUrl || `${appUrl}/dashboard?billing=portal`
  });

  return NextResponse.json({ success: true, portalUrl: session.url });
}
