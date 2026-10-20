-- PlayPen chat: run this once in the Supabase SQL editor (safe to re-run).
--
-- Privacy model: the anon key ships in the page, so the rules below never hand out
-- messages to "anyone with the key". A request only sees, or adds to, the room named in
-- its `x-room` header. Without a room's code you can't read its chat.

-- ---------- messages ----------

create table if not exists public.messages (
  id         uuid primary key,
  room       text not null check (room ~ '^[a-z0-9-]{3,32}$'),
  device     text not null check (char_length(device) between 1 and 64),
  author     text not null check (char_length(author) between 1 and 40),
  kind       text not null check (kind in ('text', 'gif', 'image')),
  body       text check (char_length(body) <= 2000),
  media      jsonb check (media is null or pg_column_size(media) <= 2048),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_at on public.messages (room, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "read messages in your room" on public.messages;
create policy "read messages in your room" on public.messages
  for select to anon
  using (room = current_setting('request.headers', true)::json ->> 'x-room');

drop policy if exists "post messages in your room" on public.messages;
create policy "post messages in your room" on public.messages
  for insert to anon
  with check (room = current_setting('request.headers', true)::json ->> 'x-room');

grant select, insert on public.messages to anon;

-- ---------- photos ----------

-- Public bucket: a photo can be opened by its link, but files can't be listed, and each
-- link carries a random id, so it can't be guessed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "upload chat photos" on storage.objects;
create policy "upload chat photos" on storage.objects
  for insert to anon
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~ '^[a-z0-9-]{3,32}$'
  );

-- ---------- active users ----------

-- Counts behind the /stats page: which days each browser had PlayPen open. A browser is
-- only its random device id; nothing else about the person or what they watched is kept.
-- The anon key can't read or change this table. It can only call track_active(), which
-- marks this browser active today, and active_users(), which returns totals.

create table if not exists public.active_days (
  day    date not null default current_date,
  device text not null check (char_length(device) between 1 and 64),
  primary key (day, device)
);

alter table public.active_days enable row level security;
revoke all on public.active_days from anon, authenticated;

create or replace function public.track_active(p_device text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into active_days (device) values (p_device) on conflict do nothing;
$$;

-- Totals, plus active users for each of the last 90 days (UTC).
create or replace function public.active_users()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with daily as (
    select d::date as day, count(a.device) as users
    from generate_series(current_date - 89, current_date, interval '1 day') d
    left join active_days a on a.day = d::date
    group by d
  )
  select json_build_object(
    'since',     (select min(day) from active_days),
    'total',     (select count(distinct device) from active_days),
    'today',     (select count(*) from active_days where day = current_date),
    'week',      (select count(distinct device) from active_days where day > current_date - 7),
    'month',     (select count(distinct device) from active_days where day > current_date - 30),
    'returning', (select count(*) from (
                    select device from active_days group by device having count(*) >= 2
                  ) r),
    'daily',     (select json_agg(json_build_object('day', day, 'users', users) order by day) from daily)
  );
$$;

grant execute on function public.track_active(text) to anon;
grant execute on function public.active_users() to anon;
