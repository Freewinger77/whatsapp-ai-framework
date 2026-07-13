export function getStripeCurrency() {
  return (process.env.STRIPE_CURRENCY || 'gbp').trim().toLowerCase();
}

export function getStripeTrialDays() {
  return Number(process.env.WASUP_STRIPE_TRIAL_DAYS || 28);
}

export function getBillingInstanceDeletionDays() {
  return Number(process.env.WASUP_BILLING_INSTANCE_DELETION_DAYS || 30);
}

export function getProMonthlyPriceCents() {
  return Number(process.env.STRIPE_INSTANCE_AMOUNT || 7900);
}

export function getProMonthlyPriceLabel() {
  const amount = getProMonthlyPriceCents() / 100;
  const formatted = amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2);
  const currency = getStripeCurrency();

  if (currency === 'gbp') return `£${formatted}`;
  if (currency === 'eur') return `€${formatted}`;
  if (currency === 'usd') return `$${formatted}`;

  return `${formatted.toUpperCase()} ${currency.toUpperCase()}`;
}

export function getProBillingMarketingLabel() {
  return `${getStripeTrialDays()}-day free trial, then ${getProMonthlyPriceLabel()}/month`;
}
