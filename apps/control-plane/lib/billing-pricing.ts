export function getStripeTrialDays() {
  return Number(process.env.WASUP_STRIPE_TRIAL_DAYS || 28);
}

export function getBillingInstanceDeletionDays() {
  return Number(process.env.WASUP_BILLING_INSTANCE_DELETION_DAYS || 30);
}

export function getProMonthlyPriceCents() {
  return Number(process.env.STRIPE_INSTANCE_AMOUNT || 19900);
}

export function getProMonthlyPriceLabel() {
  const dollars = getProMonthlyPriceCents() / 100;
  return dollars % 1 === 0 ? `$${dollars.toFixed(0)}` : `$${dollars.toFixed(2)}`;
}

export function getProBillingMarketingLabel() {
  return `${getStripeTrialDays()}-day free trial, then ${getProMonthlyPriceLabel()}/month`;
}
