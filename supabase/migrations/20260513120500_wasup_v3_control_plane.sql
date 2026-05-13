-- Wasup v3 control-plane schema.
-- Run in a new Supabase project before wiring the Next.js control plane.

create extension if not exists pgcrypto;

do $$ begin
  create type public.instance_status as enum ('provisioning', 'disconnected', 'connecting', 'connected', 'error', 'suspended');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.behavior_profile as enum ('bot-native', 'notification-balanced', 'notification-max');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.proxy_status as enum ('free', 'assigned', 'unhealthy', 'quarantined', 'released');
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text unique,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null,
  plan text not null default 'starter',
  status text not null default 'active',
  region_preference text,
  api_base_url text,
  billing_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  clerk_user_id text not null,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  unique (org_id, clerk_user_id)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  public_id text not null unique,
  secret_hash text not null,
  salt text not null,
  scopes text[] not null default array['instances:read', 'messages:send'],
  allowed_instance_ids uuid[],
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.regions (
  code text primary key,
  label text not null,
  azure_region text,
  country_iso text,
  status text not null default 'available',
  created_at timestamptz not null default now()
);

create table if not exists public.instances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  legacy_instance_id text,
  name text not null,
  phone text,
  status public.instance_status not null default 'provisioning',
  provisioning_state text not null default 'desired',
  region_code text not null references public.regions(code),
  worker_namespace text,
  worker_name text,
  worker_endpoint text,
  webhook_url text,
  webhook_secret_ref text,
  behavior_profile public.behavior_profile not null default 'notification-balanced',
  notification_grace_ms integer not null default 8000 check (notification_grace_ms between 0 and 60000),
  antiban_preset text not null default 'balanced',
  proxy_policy text not null default 'auto' check (proxy_policy in ('auto', 'imported-pool', 'dedicated-provider')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);

create table if not exists public.proxy_providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'imported-pool',
  status text not null default 'active',
  supported_regions text[] not null default '{}',
  credential_secret_ref text,
  quota jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proxy_allocations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  instance_id uuid references public.instances(id) on delete set null,
  provider_id uuid references public.proxy_providers(id) on delete set null,
  region_code text not null references public.regions(code),
  host text not null,
  port integer not null check (port > 0 and port < 65536),
  username_ref text,
  password_secret_ref text,
  source text not null default 'imported-pool',
  status public.proxy_status not null default 'free',
  egress_ip inet,
  assigned_at timestamptz,
  released_at timestamptz,
  last_verified_at timestamptz,
  health jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists proxy_allocations_one_active_per_instance
  on public.proxy_allocations(instance_id)
  where instance_id is not null and status = 'assigned';

create table if not exists public.worker_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete cascade,
  event_type text not null,
  severity text not null default 'info' check (severity in ('debug', 'info', 'warning', 'error', 'critical')),
  summary text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete set null,
  event_type text not null,
  quantity numeric not null default 1,
  unit text not null default 'count',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid references public.instances(id) on delete set null,
  event_type text not null,
  target_url text not null,
  response_status integer,
  latency_ms integer,
  attempts integer not null default 0,
  status text not null default 'pending',
  error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  actor_clerk_user_id text,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.worker_event_feed as
select
  e.id,
  e.org_id,
  o.slug as org_slug,
  e.instance_id,
  i.name as instance_name,
  e.event_type,
  e.severity,
  e.summary,
  e.created_at
from public.worker_events e
left join public.organizations o on o.id = e.org_id
left join public.instances i on i.id = e.instance_id;

insert into public.regions (code, label, azure_region, country_iso) values
  ('northeurope', 'North Europe VM', 'northeurope', 'IE'),
  ('uk-south', 'UK South', 'uksouth', 'GB'),
  ('uk-west', 'UK West', 'ukwest', 'GB'),
  ('de', 'Germany', 'germanywestcentral', 'DE'),
  ('fr', 'France', 'francecentral', 'FR'),
  ('it', 'Italy', 'italynorth', 'IT'),
  ('se', 'Sweden', 'swedencentral', 'SE'),
  ('fi', 'Finland', 'swedencentral', 'FI'),
  ('no', 'Norway', 'norwayeast', 'NO')
on conflict (code) do nothing;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.api_keys enable row level security;
alter table public.instances enable row level security;
alter table public.proxy_allocations enable row level security;
alter table public.worker_events enable row level security;
alter table public.usage_events enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.audit_events enable row level security;

-- Browser reads should go through the Next.js backend at first. These permissive
-- service-role policies make RLS explicit while keeping direct anon access closed.
create policy "service_role_full_access_organizations" on public.organizations for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_organization_members" on public.organization_members for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_api_keys" on public.api_keys for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_instances" on public.instances for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_proxy_allocations" on public.proxy_allocations for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_worker_events" on public.worker_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_usage_events" on public.usage_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_webhook_deliveries" on public.webhook_deliveries for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy "service_role_full_access_audit_events" on public.audit_events for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
