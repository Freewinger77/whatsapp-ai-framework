alter table public.notification_events
  add column if not exists read_at timestamptz;

create index if not exists notification_events_org_read_created_idx
  on public.notification_events(org_id, read_at, created_at desc);
