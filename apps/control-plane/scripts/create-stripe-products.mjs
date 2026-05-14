import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('STRIPE_SECRET_KEY is required');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey);
const currency = process.env.STRIPE_CURRENCY || 'gbp';
const instanceAmount = Number(process.env.STRIPE_INSTANCE_AMOUNT || 4900);
const creditPackAmount = Number(process.env.STRIPE_MESSAGE_CREDIT_PACK_AMOUNT || 1000);
const creditPackSize = Number(process.env.STRIPE_MESSAGE_CREDIT_PACK_SIZE || 1000);

const instanceProduct = await stripe.products.create({
  name: 'Wasup WhatsApp Instance Seat',
  description: 'One paid WhatsApp worker instance with isolated auth, webhook settings, and proxy allocation.',
  metadata: {
    wasupEntitlement: 'instance',
    wasupInstanceSlots: '1',
    wasupPlanKey: 'instance-seat'
  }
});

const instancePrice = await stripe.prices.create({
  product: instanceProduct.id,
  currency,
  unit_amount: instanceAmount,
  recurring: { interval: 'month' },
  metadata: {
    wasupEntitlement: 'instance',
    wasupInstanceSlots: '1',
    wasupPlanKey: 'instance-seat'
  }
});

const creditProduct = await stripe.products.create({
  name: `Wasup ${creditPackSize.toLocaleString('en-GB')} Monthly Message Credits`,
  description: 'Monthly metered message credit allowance for sent and received WhatsApp events.',
  metadata: {
    wasupEntitlement: 'message_credits',
    wasupMessageCredits: String(creditPackSize),
    wasupPlanKey: 'message-credits'
  }
});

const creditPrice = await stripe.prices.create({
  product: creditProduct.id,
  currency,
  unit_amount: creditPackAmount,
  recurring: { interval: 'month' },
  metadata: {
    wasupEntitlement: 'message_credits',
    wasupMessageCredits: String(creditPackSize),
    wasupPlanKey: 'message-credits'
  }
});

console.log(JSON.stringify({
  STRIPE_INSTANCE_PRICE_ID: instancePrice.id,
  STRIPE_MESSAGE_CREDIT_PRICE_ID: creditPrice.id,
  products: {
    instance: instanceProduct.id,
    messageCredits: creditProduct.id
  }
}, null, 2));
