-- Org VM provisioning, proxy leases, API credentials, and durable event history.
-- This migration is additive on top of the Wasup v3 control-plane schema.

alter table public.organizations
  add column if not exists subdomain text,
  add column if not exists deployment_status text not null default 'not_started',
  add column if not exists trial_started_at timestamptz,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_locked_at timestamptz,
  add column if not exists vm_delete_after timestamptz,
  add column if not exists trial_instance_limit integer not null default 1 check (trial_instance_limit >= 0),
  add column if not exists trial_message_credits integer not null default 250 check (trial_message_credits >= 0);

create unique index if not exists organizations_subdomain_unique
  on public.organizations(subdomain)
  where subdomain is not null;

create table if not exists public.org_deployments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  environment text not null default 'production',
  status text not null default 'not_started' check (status in ('not_started', 'queued', 'provisioning', 'dns_pending', 'ready', 'failed', 'suspended')),
  azure_subscription_id text,
  azure_resource_group text,
  azure_region text,
  vm_name text,
  vm_size text not null default 'Standard_B2s',
  public_ip inet,
  fqdn text,
  base_url text,
  worker_api_key_public_id text,
  worker_api_key_hash text,
  worker_api_key_salt text,
  internal_secret_hash text,
  internal_secret_salt text,
  deployed_version text,
  health jsonb not null default '{}'::jsonb,
  last_error text,
  requested_at timestamptz not null default now(),
  provisioned_at timestamptz,
  dns_ready_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, environment)
);

create index if not exists org_deployments_status_idx
  on public.org_deployments(status, requested_at desc);

alter table public.api_keys
  add column if not exists key_kind text not null default 'live' check (key_kind in ('live', 'test', 'worker', 'internal')),
  add column if not exists expires_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists api_keys_org_kind_idx
  on public.api_keys(org_id, key_kind)
  where revoked_at is null;

alter table public.proxy_allocations
  add column if not exists label text,
  add column if not exists username_encrypted text,
  add column if not exists password_encrypted text,
  add column if not exists credential_secret_ref text,
  add column if not exists proxy_type text not null default 'http' check (proxy_type in ('http', 'https', 'socks4', 'socks5')),
  add column if not exists assigned_by text,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists proxy_providers_name_unique
  on public.proxy_providers(name);

create unique index if not exists proxy_allocations_one_active_assignment_per_proxy
  on public.proxy_allocations(region_code, host, port)
  where status = 'assigned';

create unique index if not exists proxy_allocations_region_host_port_unique
  on public.proxy_allocations(region_code, host, port);

create index if not exists proxy_allocations_pool_lookup_idx
  on public.proxy_allocations(region_code, status, last_verified_at desc nulls last);

create table if not exists public.instance_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete set null,
  external_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  phone text,
  contact_name text,
  body text,
  status text not null default 'received',
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  received_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, external_message_id)
);

create index if not exists instance_messages_org_created_idx
  on public.instance_messages(org_id, created_at desc);

create index if not exists instance_messages_instance_created_idx
  on public.instance_messages(instance_id, created_at desc);

create index if not exists instance_messages_phone_idx
  on public.instance_messages(org_id, phone);

create table if not exists public.handoff_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete cascade,
  phone text not null,
  label text,
  status text not null default 'active' check (status in ('active', 'paused', 'released')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, instance_id, phone)
);

create table if not exists public.instance_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid not null references public.instances(id) on delete cascade,
  display_name text,
  about text,
  picture_url text,
  picture_status text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (instance_id)
);

create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  event_type text not null,
  recipient text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider text not null default 'smtp',
  idempotency_key text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (org_id, idempotency_key)
);

create index if not exists notification_events_org_created_idx
  on public.notification_events(org_id, created_at desc);

create or replace view public.proxy_pool_summary as
select
  region_code,
  count(*)::integer as total,
  count(*) filter (where status = 'free')::integer as free,
  count(*) filter (where status = 'assigned')::integer as assigned,
  count(*) filter (where status in ('unhealthy', 'quarantined'))::integer as unavailable
from public.proxy_allocations
group by region_code;

create or replace function public.claim_proxy_for_instance(
  p_org_id uuid,
  p_instance_id uuid,
  p_region_code text,
  p_assigned_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.proxy_allocations%rowtype;
  candidate public.proxy_allocations%rowtype;
begin
  select *
  into existing
  from public.proxy_allocations
  where instance_id = p_instance_id
    and status = 'assigned'
  limit 1;

  if found then
    return to_jsonb(existing);
  end if;

  select *
  into candidate
  from public.proxy_allocations
  where region_code = p_region_code
    and status = 'free'
  order by coalesce(last_verified_at, created_at) desc, created_at asc
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object('assigned', false, 'reason', 'no_proxy_available', 'regionCode', p_region_code);
  end if;

  update public.proxy_allocations
  set org_id = p_org_id,
      instance_id = p_instance_id,
      status = 'assigned',
      assigned_at = now(),
      released_at = null,
      assigned_by = p_assigned_by,
      updated_at = now()
  where id = candidate.id
  returning * into candidate;

  return to_jsonb(candidate) || jsonb_build_object('assigned', true);
end;
$$;

create or replace function public.release_proxy_for_instance(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  released public.proxy_allocations%rowtype;
begin
  update public.proxy_allocations
  set org_id = null,
      instance_id = null,
      status = 'free',
      released_at = now(),
      assigned_by = null,
      updated_at = now()
  where instance_id = p_instance_id
    and status = 'assigned'
  returning * into released;

  if not found then
    return jsonb_build_object('released', false, 'reason', 'no_active_proxy_assignment');
  end if;

  return to_jsonb(released) || jsonb_build_object('released', true);
end;
$$;

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
  org_record public.organizations%rowtype;
  active_instances integer;
  booked_instances integer;
begin
  select *
  into entitlement
  from public.billing_entitlements
  where org_id = p_org_id
  for update;

  if found then
    if entitlement.status not in ('trialing', 'active') then
      return jsonb_build_object('allowed', false, 'reason', 'billing_status_' || entitlement.status, 'mode', 'billing');
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
  end if;

  select *
  into org_record
  from public.organizations
  where id = p_org_id
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'organization_not_found', 'mode', 'trial');
  end if;

  if org_record.trial_started_at is null then
    update public.organizations
    set trial_started_at = now(),
        trial_ends_at = now() + make_interval(days => p_trial_days),
        updated_at = now()
    where id = p_org_id
    returning * into org_record;
  end if;

  if org_record.trial_ends_at is not null and org_record.trial_ends_at < now() then
    return jsonb_build_object('allowed', false, 'reason', 'trial_expired', 'mode', 'trial', 'trialEndsAt', org_record.trial_ends_at);
  end if;

  select count(*)::integer
  into active_instances
  from public.instances
  where org_id = p_org_id
    and deleted_at is null
    and status <> 'suspended';

  if active_instances >= org_record.trial_instance_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'trial_instance_limit_reached',
      'mode', 'trial',
      'trialInstanceLimit', org_record.trial_instance_limit,
      'activeInstanceCount', active_instances
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'mode', 'trial',
    'trialInstanceLimit', org_record.trial_instance_limit,
    'activeInstanceCount', active_instances,
    'trialEndsAt', org_record.trial_ends_at
  );
end;
$$;

create or replace function public.record_instance_event(
  p_org_id uuid,
  p_instance_id uuid,
  p_event_type text,
  p_severity text,
  p_summary text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  insert into public.worker_events (org_id, instance_id, event_type, severity, summary, payload)
  values (p_org_id, p_instance_id, p_event_type, coalesce(p_severity, 'info'), p_summary, coalesce(p_payload, '{}'::jsonb))
  returning id into event_id;

  return event_id;
end;
$$;

create or replace function public.record_message_event(
  p_org_id uuid,
  p_instance_id uuid,
  p_external_message_id text,
  p_direction text,
  p_phone text,
  p_body text,
  p_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_id uuid;
begin
  insert into public.instance_messages (
    org_id,
    instance_id,
    external_message_id,
    direction,
    phone,
    body,
    status,
    metadata,
    sent_at,
    received_at
  )
  values (
    p_org_id,
    p_instance_id,
    p_external_message_id,
    p_direction,
    p_phone,
    p_body,
    coalesce(p_status, case when p_direction = 'outbound' then 'sent' else 'received' end),
    coalesce(p_metadata, '{}'::jsonb),
    case when p_direction = 'outbound' then now() else null end,
    case when p_direction = 'inbound' then now() else null end
  )
  on conflict (org_id, external_message_id) do update
    set status = excluded.status,
        metadata = public.instance_messages.metadata || excluded.metadata,
        seen_at = case when excluded.status = 'seen' then now() else public.instance_messages.seen_at end
  returning id into message_id;

  return message_id;
end;
$$;

alter table public.org_deployments enable row level security;
alter table public.instance_messages enable row level security;
alter table public.handoff_numbers enable row level security;
alter table public.instance_profiles enable row level security;
alter table public.notification_events enable row level security;

create policy "service_role_full_access_org_deployments" on public.org_deployments for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_instance_messages" on public.instance_messages for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_handoff_numbers" on public.handoff_numbers for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_instance_profiles" on public.instance_profiles for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_notification_events" on public.notification_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
