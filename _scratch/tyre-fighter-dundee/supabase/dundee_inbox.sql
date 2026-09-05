-- Isolated Tyre Fighter Dundee inbox. Do not write into chat_history / tyreflow_*.

create table if not exists public.dundee_lines (
  id uuid primary key default gen_random_uuid(),
  instance_id text not null unique,
  phone text not null default '',
  display_name text not null default 'Tyre Fighter Dundee',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dundee_conversations (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.dundee_lines(id) on delete cascade,
  chat_jid text not null,
  kind text not null check (kind in ('dm', 'group')),
  title text,
  last_preview text,
  last_message_at timestamptz,
  last_direction text,
  inbound_count integer not null default 0,
  outbound_count integer not null default 0,
  unanswered_since timestamptz,
  participant_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_id, chat_jid)
);

create table if not exists public.dundee_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dundee_conversations(id) on delete cascade,
  phone text not null default '',
  lid text,
  display_name text,
  is_me boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (conversation_id, phone)
);

create table if not exists public.dundee_messages (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.dundee_lines(id) on delete cascade,
  conversation_id uuid not null references public.dundee_conversations(id) on delete cascade,
  wa_message_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_me boolean not null default false,
  sender_phone text,
  sender_name text,
  body text not null default '',
  media_type text,
  media_url text,
  media_id text,
  quoted_text text,
  chat_jid text not null,
  sent_at timestamptz not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (line_id, wa_message_id)
);

create table if not exists public.dundee_ingest_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dundee_conversations_activity_idx
  on public.dundee_conversations (line_id, last_message_at desc nulls last);

create index if not exists dundee_messages_thread_idx
  on public.dundee_messages (conversation_id, sent_at);

create index if not exists dundee_messages_sent_idx
  on public.dundee_messages (sent_at desc);

create index if not exists dundee_ingest_log_created_idx
  on public.dundee_ingest_log (created_at desc);

alter table public.dundee_lines enable row level security;
alter table public.dundee_conversations enable row level security;
alter table public.dundee_participants enable row level security;
alter table public.dundee_messages enable row level security;
alter table public.dundee_ingest_log enable row level security;

drop policy if exists dundee_lines_select_auth on public.dundee_lines;
drop policy if exists dundee_conversations_select_auth on public.dundee_conversations;
drop policy if exists dundee_participants_select_auth on public.dundee_participants;
drop policy if exists dundee_messages_select_auth on public.dundee_messages;

create policy dundee_lines_select_auth
  on public.dundee_lines for select to authenticated using (true);

create policy dundee_conversations_select_auth
  on public.dundee_conversations for select to authenticated using (true);

create policy dundee_participants_select_auth
  on public.dundee_participants for select to authenticated using (true);

create policy dundee_messages_select_auth
  on public.dundee_messages for select to authenticated using (true);

revoke all on public.dundee_lines from anon, public;
revoke all on public.dundee_conversations from anon, public;
revoke all on public.dundee_participants from anon, public;
revoke all on public.dundee_messages from anon, public;
revoke all on public.dundee_ingest_log from anon, public;

grant select on public.dundee_lines to authenticated;
grant select on public.dundee_conversations to authenticated;
grant select on public.dundee_participants to authenticated;
grant select on public.dundee_messages to authenticated;

grant all on public.dundee_lines to service_role;
grant all on public.dundee_conversations to service_role;
grant all on public.dundee_participants to service_role;
grant all on public.dundee_messages to service_role;
grant all on public.dundee_ingest_log to service_role;

create or replace function public.dundee_ingest_message(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_instance text;
  v_line_id uuid;
  v_chat_jid text;
  v_kind text;
  v_wa_id text;
  v_direction text;
  v_from_me boolean;
  v_body text;
  v_sent_at timestamptz;
  v_conv_id uuid;
  v_sender_phone text;
  v_media_type text;
  v_media_url text;
  v_media_id text;
  v_title text;
begin
  v_instance := coalesce(payload->>'instance_id', payload->>'webhook_id');
  if v_instance is null or btrim(v_instance) = '' then
    raise exception 'instance_id required';
  end if;

  insert into public.dundee_lines (instance_id, phone, display_name)
  values (
    v_instance,
    coalesce(payload->>'to_phone', payload->>'line_phone', ''),
    coalesce(payload->>'line_name', 'Tyre Fighter Dundee')
  )
  on conflict (instance_id) do update
    set phone = case when excluded.phone <> '' then excluded.phone else public.dundee_lines.phone end,
        display_name = coalesce(nullif(excluded.display_name, ''), public.dundee_lines.display_name),
        updated_at = now()
  returning id into v_line_id;

  v_chat_jid := nullif(payload->>'from_jid', '');
  if v_chat_jid is null then
    if coalesce((payload->>'is_group')::boolean, false)
       or nullif(payload->>'group_id', '') is not null then
      v_chat_jid := coalesce(payload->>'group_id', payload->>'from_phone') || '@g.us';
    else
      v_chat_jid := coalesce(payload->>'from_phone', payload->>'chat_id') || '@s.whatsapp.net';
    end if;
  end if;

  v_kind := case
    when coalesce((payload->>'is_group')::boolean, false) or v_chat_jid like '%@g.us' then 'group'
    else 'dm'
  end;

  v_wa_id := coalesce(payload->>'whatsapp_message_id', payload->>'id', payload->>'message_id');
  if v_wa_id is null or btrim(v_wa_id) = '' then
    raise exception 'whatsapp_message_id required';
  end if;

  v_from_me := coalesce(
    (payload->>'from_me')::boolean,
    payload->>'direction' = 'outbound',
    false
  );
  v_direction := case when v_from_me then 'outbound' else coalesce(nullif(payload->>'direction', ''), 'inbound') end;
  v_body := coalesce(payload->>'message', payload->>'text', payload->>'body', '');
  v_sent_at := coalesce(
    (payload->>'created_at')::timestamptz,
    (payload->>'timestamp')::timestamptz,
    now()
  );
  v_sender_phone := nullif(payload->>'sender_phone', '');
  if v_sender_phone is null and v_kind = 'dm' and not v_from_me then
    v_sender_phone := nullif(payload->>'from_phone', '');
  end if;
  v_media_type := nullif(payload->>'media_type', '');
  v_media_url := coalesce(nullif(payload->>'media_url', ''), payload->'media'->>'publicUrl');
  v_media_id := coalesce(nullif(payload->>'media_id', ''), payload->'media'->>'id');

  v_title := coalesce(
    nullif(payload->>'group_name', ''),
    nullif(payload->>'conversation_title', ''),
    case
      when v_kind = 'group' then 'Group ' || right(split_part(v_chat_jid, '@', 1), 8)
      else coalesce(nullif(payload->>'push_name', ''), v_sender_phone, split_part(v_chat_jid, '@', 1))
    end
  );

  insert into public.dundee_conversations (
    line_id, chat_jid, kind, title, last_preview, last_message_at, last_direction
  ) values (
    v_line_id, v_chat_jid, v_kind, v_title, left(v_body, 240), v_sent_at, v_direction
  )
  on conflict (line_id, chat_jid) do update
    set last_preview = excluded.last_preview,
        last_message_at = greatest(
          coalesce(public.dundee_conversations.last_message_at, excluded.last_message_at),
          excluded.last_message_at
        ),
        last_direction = case
          when excluded.last_message_at >= coalesce(public.dundee_conversations.last_message_at, excluded.last_message_at)
            then excluded.last_direction
          else public.dundee_conversations.last_direction
        end,
        updated_at = now()
  returning id into v_conv_id;

  insert into public.dundee_messages (
    line_id, conversation_id, wa_message_id, direction, from_me,
    sender_phone, sender_name, body, media_type, media_url, media_id,
    quoted_text, chat_jid, sent_at, raw
  ) values (
    v_line_id, v_conv_id, v_wa_id, v_direction, v_from_me,
    v_sender_phone, nullif(payload->>'push_name', ''),
    v_body, v_media_type, v_media_url, v_media_id,
    nullif(payload->>'quoted_message', ''),
    v_chat_jid, v_sent_at, payload
  )
  on conflict (line_id, wa_message_id) do update
    set body = excluded.body,
        media_url = coalesce(excluded.media_url, public.dundee_messages.media_url),
        media_id = coalesce(excluded.media_id, public.dundee_messages.media_id),
        sender_name = coalesce(excluded.sender_name, public.dundee_messages.sender_name),
        raw = excluded.raw;

  if v_sender_phone is not null then
    insert into public.dundee_participants (conversation_id, phone, lid, display_name, is_me)
    values (
      v_conv_id,
      v_sender_phone,
      nullif(payload->>'sender_jid', ''),
      nullif(payload->>'push_name', ''),
      v_from_me
    )
    on conflict (conversation_id, phone) do update
      set display_name = coalesce(excluded.display_name, public.dundee_participants.display_name),
          lid = coalesce(excluded.lid, public.dundee_participants.lid),
          updated_at = now();
  end if;

  update public.dundee_conversations c
  set
    inbound_count = (select count(*) from public.dundee_messages m where m.conversation_id = c.id and m.direction = 'inbound'),
    outbound_count = (select count(*) from public.dundee_messages m where m.conversation_id = c.id and m.direction = 'outbound'),
    unanswered_since = case
      when c.kind = 'dm' and (
        select m.direction from public.dundee_messages m
        where m.conversation_id = c.id
        order by m.sent_at desc
        limit 1
      ) = 'inbound'
      then (
        select max(m.sent_at) from public.dundee_messages m
        where m.conversation_id = c.id and m.direction = 'inbound'
      )
      else null
    end,
    participant_count = (select count(*) from public.dundee_participants p where p.conversation_id = c.id),
    updated_at = now()
  where c.id = v_conv_id;

  insert into public.dundee_ingest_log (source, payload)
  values (coalesce(payload->>'source', 'unknown'), payload);

  delete from public.dundee_ingest_log
  where id in (
    select id from public.dundee_ingest_log
    order by created_at desc
    offset 200
  );

  return jsonb_build_object(
    'ok', true,
    'line_id', v_line_id,
    'conversation_id', v_conv_id,
    'chat_jid', v_chat_jid
  );
end;
$$;

revoke all on function public.dundee_ingest_message(jsonb) from public, anon, authenticated;
grant execute on function public.dundee_ingest_message(jsonb) to service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.dundee_conversations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.dundee_messages;
  exception when duplicate_object then null;
  end;
end $$;
