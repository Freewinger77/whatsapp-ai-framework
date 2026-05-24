-- Billing and entitlement state for paid Wasup v3 provisioning.
-- Stripe remains the source of truth; these tables are the fast control-plane cache.

create table if not exists public.billing_entitlements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'inactive' check (status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused', 'inactive')),
  plan_key text not null default 'starter',
  paid_instance_limit integer not null default 0 check (paid_instance_limit >= 0),
  reserved_instance_count integer not null default 0 check (reserved_instance_count >= 0),
  included_message_credits integer not null default 0 check (included_message_credits >= 0),
  extra_message_credits integer not null default 0 check (extra_message_credits >= 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id),
  unique (provider, provider_subscription_id)
);

create index if not exists billing_entitlements_org_status_idx
  on public.billing_entitlements(org_id, status);

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  unique (provider, provider_event_id)
);

create table if not exists public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete set null,
  source text not null check (source in ('stripe', 'usage', 'manual', 'system')),
  event_type text not null,
  quantity integer not null,
  balance_after integer,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);

create index if not exists credit_ledger_org_created_idx
  on public.credit_ledger_entries(org_id, created_at desc);

alter table public.usage_events
  add column if not exists idempotency_key text;

create unique index if not exists usage_events_org_idempotency_idx
  on public.usage_events(org_id, idempotency_key)
  where idempotency_key is not null;

create or replace view public.org_billing_summary as
with instance_counts as (
  select
    org_id,
    count(*) filter (where deleted_at is null and status <> 'suspended')::integer as active_instance_count
  from public.instances
  group by org_id
),
credit_balances as (
  select
    org_id,
    coalesce(sum(quantity), 0)::integer as ledger_balance
  from public.credit_ledger_entries
  group by org_id
)
select
  o.id as org_id,
  o.slug,
  o.name,
  o.plan,
  o.status as org_status,
  o.billing_customer_id,
  coalesce(be.status, 'inactive') as billing_status,
  coalesce(be.paid_instance_limit, 0) as paid_instance_limit,
  coalesce(be.reserved_instance_count, 0) as reserved_instance_count,
  coalesce(ic.active_instance_count, 0) as active_instance_count,
  greatest(
    coalesce(be.paid_instance_limit, 0) -
    greatest(
      coalesce(be.reserved_instance_count, 0),
      coalesce(ic.active_instance_count, 0)
    ),
    0
  ) as available_instance_slots,
  coalesce(be.included_message_credits, 0) + coalesce(be.extra_message_credits, 0) + coalesce(cb.ledger_balance, 0) as message_credit_balance,
  be.current_period_start,
  be.current_period_end,
  be.cancel_at_period_end
from public.organizations o
left join public.billing_entitlements be on be.org_id = o.id
left join instance_counts ic on ic.org_id = o.id
left join credit_balances cb on cb.org_id = o.id;

create or replace function public.reserve_instance_entitlement(p_org_id uuid)
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
    return jsonb_build_object('allowed', false, 'reason', 'missing_entitlement');
  end if;

  if entitlement.status not in ('trialing', 'active') then
    return jsonb_build_object('allowed', false, 'reason', 'billing_status_' || entitlement.status);
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
    'paidInstanceLimit', entitlement.paid_instance_limit,
    'activeInstanceCount', active_instances,
    'reservedInstanceCount', booked_instances + 1
  );
end;
$$;

create or replace function public.release_instance_entitlement(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.billing_entitlements
  set reserved_instance_count = greatest(reserved_instance_count - 1, 0),
      updated_at = now()
  where org_id = p_org_id;
end;
$$;

create or replace function public.record_metered_usage(
  p_org_id uuid,
  p_instance_id uuid,
  p_event_type text,
  p_quantity numeric,
  p_unit text,
  p_credit_cost integer,
  p_idempotency_key text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.billing_entitlements%rowtype;
  current_balance integer;
  usage_id uuid;
begin
  select *
  into entitlement
  from public.billing_entitlements
  where org_id = p_org_id
  for update;

  if not found or entitlement.status not in ('trialing', 'active') then
    return jsonb_build_object('accepted', false, 'reason', 'billing_inactive');
  end if;

  select coalesce(entitlement.included_message_credits, 0) +
         coalesce(entitlement.extra_message_credits, 0) +
         coalesce(sum(quantity), 0)::integer
  into current_balance
  from public.credit_ledger_entries
  where org_id = p_org_id;

  if p_credit_cost > 0 and current_balance < p_credit_cost then
    return jsonb_build_object(
      'accepted', false,
      'reason', 'insufficient_credits',
      'messageCreditBalance', current_balance,
      'creditCost', p_credit_cost
    );
  end if;

  insert into public.usage_events (
    org_id,
    instance_id,
    event_type,
    quantity,
    unit,
    metadata,
    idempotency_key
  )
  values (
    p_org_id,
    p_instance_id,
    p_event_type,
    p_quantity,
    p_unit,
    coalesce(p_metadata, '{}'::jsonb),
    p_idempotency_key
  )
  on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing
  returning id into usage_id;

  if usage_id is null then
    return jsonb_build_object('accepted', true, 'duplicate', true, 'messageCreditBalance', current_balance);
  end if;

  if p_credit_cost > 0 then
    insert into public.credit_ledger_entries (
      org_id,
      instance_id,
      source,
      event_type,
      quantity,
      balance_after,
      idempotency_key,
      metadata
    )
    values (
      p_org_id,
      p_instance_id,
      'usage',
      p_event_type,
      -p_credit_cost,
      current_balance - p_credit_cost,
      p_idempotency_key,
      jsonb_build_object('usageEventId', usage_id)
    )
    on conflict (org_id, idempotency_key) do nothing;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'usageEventId', usage_id,
    'messageCreditBalance', current_balance - greatest(p_credit_cost, 0)
  );
end;
$$;

alter table public.billing_entitlements enable row level security;
alter table public.billing_events enable row level security;
alter table public.credit_ledger_entries enable row level security;

create policy "service_role_full_access_billing_entitlements" on public.billing_entitlements for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_billing_events" on public.billing_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_credit_ledger_entries" on public.credit_ledger_entries for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
