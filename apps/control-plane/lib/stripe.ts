import Stripe from 'stripe';

let stripeClient: Stripe | null = null;

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is required for billing operations');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required for Stripe webhooks');
  }
  return secret;
}

export function getWasupAppUrl(req: Request) {
  return process.env.WASUP_CONTROL_PLANE_URL || new URL(req.url).origin;
}
