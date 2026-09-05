-- SMT CRM tables. Isolated from dundee_* and chat_history.
-- RLS on; no anon / authenticated policies. Server uses the secret key.

create table if not exists public.smt_customers (
  id uuid primary key default gen_random_uuid(),
  smt_id text not null unique,
  phone_e164 text,
  name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  postcode text,
  source text,
  stage text,
  last_booking_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  webhook_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smt_enquiries (
  id uuid primary key default gen_random_uuid(),
  smt_id text not null unique,
  customer_smt_id text,
  name text,
  phone text,
  phone_e164 text,
  email text,
  status text,
  source text,
  notes text,
  channel text,
  message text,
  tags text,
  enquired_at timestamptz,
  in_hours boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  webhook_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smt_nps (
  id uuid primary key default gen_random_uuid(),
  smt_id text not null unique,
  score integer not null,
  reason text,
  comment text,
  name text,
  phone text,
  phone_e164 text,
  scored_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  webhook_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smt_testimonials (
  id uuid primary key default gen_random_uuid(),
  smt_id text not null unique,
  name text,
  quote text,
  published_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  raw jsonb,
  webhook_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.smt_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  message text,
  record_type text,
  record_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.smt_poll_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean not null default false,
  scraped integer not null default 0,
  new_count integer not null default 0,
  webhooked integer not null default 0,
  refreshed integer not null default 0,
  error text,
  announce boolean not null default true
);

create table if not exists public.smt_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

create index if not exists smt_customers_phone_idx on public.smt_customers (phone_e164);
create index if not exists smt_customers_seen_idx on public.smt_customers (first_seen_at desc);
create index if not exists smt_enquiries_at_idx on public.smt_enquiries (enquired_at desc);
create index if not exists smt_enquiries_hours_idx on public.smt_enquiries (in_hours);
create index if not exists smt_nps_at_idx on public.smt_nps (scored_at desc);
create index if not exists smt_events_created_idx on public.smt_events (created_at desc);
create index if not exists smt_events_record_idx on public.smt_events (record_type, record_id);

alter table public.smt_customers enable row level security;
alter table public.smt_enquiries enable row level security;
alter table public.smt_nps enable row level security;
alter table public.smt_testimonials enable row level security;
alter table public.smt_events enable row level security;
alter table public.smt_poll_runs enable row level security;
alter table public.smt_settings enable row level security;

revoke all on public.smt_customers from anon, authenticated;
revoke all on public.smt_enquiries from anon, authenticated;
revoke all on public.smt_nps from anon, authenticated;
revoke all on public.smt_testimonials from anon, authenticated;
revoke all on public.smt_events from anon, authenticated;
revoke all on public.smt_poll_runs from anon, authenticated;
revoke all on public.smt_settings from anon, authenticated;

grant all on public.smt_customers to service_role;
grant all on public.smt_enquiries to service_role;
grant all on public.smt_nps to service_role;
grant all on public.smt_testimonials to service_role;
grant all on public.smt_events to service_role;
grant all on public.smt_poll_runs to service_role;
grant all on public.smt_settings to service_role;

alter table public.smt_enquiries add column if not exists channel text;
alter table public.smt_enquiries add column if not exists message text;
alter table public.smt_enquiries add column if not exists tags text;
create index if not exists smt_enquiries_channel_idx on public.smt_enquiries (channel);
