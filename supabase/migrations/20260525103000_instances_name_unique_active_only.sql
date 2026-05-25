-- Soft-deleted instances kept the (org_id, name) unique constraint, blocking name reuse.
-- Only enforce uniqueness among active (non-deleted) rows.

alter table public.instances
  drop constraint if exists instances_org_id_name_key;

create unique index if not exists instances_org_id_name_active_key
  on public.instances (org_id, name)
  where deleted_at is null;
