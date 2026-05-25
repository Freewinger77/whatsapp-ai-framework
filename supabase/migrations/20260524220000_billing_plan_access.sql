-- Pro vs free plan enforcement and instance limits.
-- Grace/lock timestamps are stored in billing_entitlements.metadata (no new org columns required).

create or replace function public.ensure_org_entitlement_or_trial(
  p_org_id uuid,
  p_trial_days integer default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.billing_entitlements%rowtype;
  active_instances integer;
  booked_instances integer;
begin
  select *
  into entitlement
  from public.billing_entitlements
  where org_id = p_org_id
  for update;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'pro_subscription_required',
      'mode', 'free'
    );
  end if;

  if entitlement.status not in ('trialing', 'active') then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'billing_status_' || entitlement.status,
      'mode', 'billing',
      'billingStatus', entitlement.status
    );
  end if;

  select count(*)::integer
  into active_instances
  from public.instances
  where org_id = p_org_id
    and deleted_at is null
    and status <> 'suspended';

  booked_instances := greatest(active_instances, entitlement.reserved_instance_count);
  if booked_instances >= entitlement.paid_instance_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'instance_limit_reached',
      'mode', 'billing',
      'paidInstanceLimit', entitlement.paid_instance_limit,
      'activeInstanceCount', active_instances,
      'reservedInstanceCount', entitlement.reserved_instance_count
    );
  end if;

  update public.billing_entitlements
  set reserved_instance_count = booked_instances + 1,
      updated_at = now()
  where id = entitlement.id;

  return jsonb_build_object(
    'allowed', true,
    'mode', 'billing',
    'paidInstanceLimit', entitlement.paid_instance_limit,
    'activeInstanceCount', active_instances,
    'reservedInstanceCount', booked_instances + 1
  );
end;
$$;
