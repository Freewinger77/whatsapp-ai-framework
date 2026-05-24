import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ensureStripeCustomerForOrg } from '../../../../../lib/billing';
import { isAuthError, requireWasupPrincipal } from '../../../../../lib/auth';
import { getStripe, getWasupAppUrl } from '../../../../../lib/stripe';

const CheckoutSchema = z.object({
  orgId: z.string().uuid().optional(),
  instanceQuantity: z.number().int().min(1).max(500).default(1),
  messageCreditQuantity: z.number().int().min(0).max(1000).default(0),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional()
});

export async function POST(req: Request) {
  const principal = await requireWasupPrincipal(req);
  if (isAuthError(principal)) return principal;

  const parsed = CheckoutSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', issues: parsed.error.flatten() }, { status: 400 });
  }

  const body = parsed.data;
  const orgId = body.orgId || principal.orgId;
  if (orgId !== principal.orgId && principal.role !== 'owner' && principal.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const appUrl = getWasupAppUrl(req);
  const instancePrice = process.env.STRIPE_INSTANCE_PRICE_ID;
  const creditPrice = process.env.STRIPE_MESSAGE_CREDIT_PRICE_ID;

  if (!instancePrice) {
    return NextResponse.json({ error: 'STRIPE_INSTANCE_PRICE_ID is not configured' }, { status: 500 });
  }

  const customer = await ensureStripeCustomerForOrg(orgId);
  const lineItems = [
    {
      price: instancePrice,
      quantity: body.instanceQuantity
    }
  ];

  if (creditPrice && body.messageCreditQuantity > 0) {
    lineItems.push({
      price: creditPrice,
      quantity: body.messageCreditQuantity
    });
  }

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: lineItems,
    success_url: body.successUrl || `${appUrl}/dashboard?billing=success`,
    cancel_url: body.cancelUrl || `${appUrl}/dashboard?billing=cancelled`,
    allow_promotion_codes: true,
    client_reference_id: orgId,
    subscription_data: {
      metadata: {
        wasupOrgId: orgId,
        wasupCreatedBy: principal.actorId,
        wasupPlanKey: 'instance-seat'
      }
    },
    metadata: {
      wasupOrgId: orgId,
      wasupKind: 'subscription_checkout',
      wasupPlanKey: 'instance-seat'
    }
  });

  return NextResponse.json({ success: true, checkoutUrl: session.url, sessionId: session.id });
}
