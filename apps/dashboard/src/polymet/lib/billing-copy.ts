export const WASUP_PRO_MONTHLY_PRICE = "$199/month";
export const WASUP_PRO_TRIAL_DAYS = 28;
export const WASUP_PRO_TRIAL_LABEL = `${WASUP_PRO_TRIAL_DAYS}-day free trial`;
export const WASUP_PRO_INSTANCE_LIMIT = 5;

export function wasupProSubscribeLabel() {
  return `Start ${WASUP_PRO_TRIAL_LABEL}`;
}

export function wasupProPlanHint() {
  return `Wasup Pro includes a ${WASUP_PRO_TRIAL_LABEL}, then ${WASUP_PRO_MONTHLY_PRICE} for up to ${WASUP_PRO_INSTANCE_LIMIT} instances.`;
}

export function wasupProUpgradeDescription() {
  return `Start your ${WASUP_PRO_TRIAL_LABEL}, then ${WASUP_PRO_MONTHLY_PRICE} for up to ${WASUP_PRO_INSTANCE_LIMIT} instances.`;
}
