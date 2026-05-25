import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('STRIPE_SECRET_KEY is required');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey);
const currency = process.env.STRIPE_CURRENCY || 'usd';
const instanceAmount = Number(process.env.STRIPE_INSTANCE_AMOUNT || 19900);
const creditPackAmount = Number(process.env.STRIPE_MESSAGE_CREDIT_PACK_AMOUNT || 1000);
const creditPackSize = Number(process.env.STRIPE_MESSAGE_CREDIT_PACK_SIZE || 1000);
const promoCode = process.env.STRIPE_PROMOTION_CODE || 'wasup100';

const instanceProduct = await findProductByMetadata('wasupPlanKey', 'pro') || await findProductByMetadata('wasupPlanKey', 'instance-seat') || await stripe.products.create({
  name: 'Wasup Pro',
  description: 'Monthly Wasup Pro subscription — up to 5 WhatsApp instances, worker URL, API keys, and storage.',
  metadata: {
    wasupEntitlement: 'instance',
    wasupInstanceSlots: '5',
    wasupPlanKey: 'pro'
  }
});

const instancePrice = await findPrice(instanceProduct.id, currency, instanceAmount) || await stripe.prices.create({
  product: instanceProduct.id,
  currency,
  unit_amount: instanceAmount,
  recurring: { interval: 'month' },
  metadata: {
    wasupEntitlement: 'instance',
    wasupInstanceSlots: '5',
    wasupPlanKey: 'pro'
  }
});

const creditProduct = await findProductByMetadata('wasupPlanKey', 'message-credits') || await stripe.products.create({
  name: `Wasup ${creditPackSize.toLocaleString('en-GB')} Monthly Message Credits`,
  description: 'Monthly metered message credit allowance for sent and received WhatsApp events.',
  metadata: {
    wasupEntitlement: 'message_credits',
    wasupMessageCredits: String(creditPackSize),
    wasupPlanKey: 'message-credits'
  }
});

const creditPrice = await findPrice(creditProduct.id, currency, creditPackAmount) || await stripe.prices.create({
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

const coupon = await findCoupon('wasup100') || await findCoupon('VIPER100') || await stripe.coupons.create({
  name: 'wasup100',
  percent_off: 100,
  duration: 'forever',
  metadata: {
    wasupPromoCode: promoCode,
    wasupDiscount: 'full_comp'
  }
});

const promotionCode = await findPromotionCode(promoCode) || await stripe.promotionCodes.create({
  promotion: {
    type: 'coupon',
    coupon: coupon.id
  },
  code: promoCode,
  active: true,
  metadata: {
    wasupPromoCode: promoCode
  }
});

console.log(JSON.stringify({
  STRIPE_INSTANCE_PRICE_ID: instancePrice.id,
  STRIPE_MESSAGE_CREDIT_PRICE_ID: creditPrice.id,
  STRIPE_WASUP100_COUPON_ID: coupon.id,
  STRIPE_WASUP100_PROMOTION_CODE_ID: promotionCode.id,
  products: {
    instance: instanceProduct.id,
    messageCredits: creditProduct.id
  }
}, null, 2));

async function findProductByMetadata(key, value) {
  for await (const product of stripe.products.list({ active: true, limit: 100 })) {
    if (product.metadata?.[key] === value) return product;
  }
  return null;
}

async function findPrice(productId, priceCurrency, unitAmount) {
  for await (const price of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (
      price.currency === priceCurrency &&
      price.unit_amount === unitAmount &&
      price.recurring?.interval === 'month'
    ) {
      return price;
    }
  }
  return null;
}

async function findCoupon(name) {
  for await (const coupon of stripe.coupons.list({ limit: 100 })) {
    if (coupon.name === name && coupon.valid) return coupon;
  }
  return null;
}

async function findPromotionCode(code) {
  const promotionCodes = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  return promotionCodes.data[0] || null;
}
