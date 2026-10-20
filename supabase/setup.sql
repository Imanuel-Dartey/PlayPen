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
