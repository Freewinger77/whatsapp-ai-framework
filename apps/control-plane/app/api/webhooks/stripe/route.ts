import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { grantMessageCreditsFromCheckout, recordStripeEvent, syncStripeSubscription } from '../../../../lib/billing';
import { getStripe, getStripeWebhookSecret } from '../../../../lib/stripe';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const payload = await req.text();
    event = getStripe().webhooks.constructEvent(payload, signature, getStripeWebhookSecret());
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid Stripe webhook: ${error instanceof Error ? error.message : 'unknown error'}` },
      { status: 400 }
    );
  }

  const recorded = await recordStripeEvent(event);
  if (recorded.duplicate) {
    return NextResponse.json({ success: true, duplicate: true });
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'subscription' && session.subscription) {
        await syncStripeSubscription(asStripeId(session.subscription));
      }
      if (session.mode === 'payment') {
        await grantMessageCreditsFromCheckout(session);
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed': {
      const subscription = event.data.object as Stripe.Subscription;
      await syncStripeSubscription(subscription.id);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ success: true });
}

function asStripeId(value: string | { id: string }) {
  return typeof value === 'string' ? value : value.id;
}
