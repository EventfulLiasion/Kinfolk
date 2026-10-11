-- Persistent per-user hides and sender-authorized shared tombstones.
alter table public.messages
  add column if not exists deleted_at timestamptz;

create table if not exists public.message_deletions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists messages_attachment_path_idx
  on public.messages(storage_path) where storage_path is not null;

alter table public.message_deletions enable row level security;

drop policy if exists "Users can view their own message hides" on public.message_deletions;
create policy "Users can view their own message hides"
on public.message_deletions for select to authenticated
using (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "Members can hide messages for themselves" on public.message_deletions;
create policy "Members can hide messages for themselves"
on public.message_deletions for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.messages m
    where m.id = message_id
      and m.deleted_at is null
      and public.is_conversation_member(m.conversation_id)
  )
);

revoke all on public.message_deletions from public, anon, authenticated;
grant select, insert on public.message_deletions to authenticated;

create or replace function public.delete_message_for_everyone(target_message uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  message_row record;
  cleanup_path text;
begin
  if caller_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select m.sender_id, m.conversation_id, m.storage_path, m.deleted_at
  into message_row
  from public.messages m
  where m.id = target_message
  for update;

  if not found then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;
  if message_row.sender_id <> caller_id
     or not public.is_conversation_member(message_row.conversation_id) then
    raise exception 'Only the message sender can delete it for everyone.' using errcode = '42501';
  end if;

  if message_row.deleted_at is not null then
    return null;
  end if;

  if message_row.storage_path is not null
     and (storage.foldername(message_row.storage_path))[2] = caller_id::text
     and array_length(storage.foldername(message_row.storage_path), 1) = 2 then
    cleanup_path := message_row.storage_path;
  end if;

  update public.messages
  set body = 'This message was deleted',
      content_type = 'text',
      storage_path = null,
      attachment_name = null,
      mime_type = null,
      file_size = null,
      deleted_at = now()
  where id = target_message;

  return cleanup_path;
end;
$$;

revoke all on function public.delete_message_for_everyone(uuid) from public, anon;
grant execute on function public.delete_message_for_everyone(uuid) to authenticated;

-- An attachment is readable only while an undeleted message references it.
-- This blocks new signed URLs even if object cleanup later fails.
drop policy if exists "Members can view conversation media" on storage.objects;
create policy "Members can view conversation media"
on storage.objects for select to authenticated
using (
  bucket_id = 'kinfolk-media'
  and public.is_conversation_media_path(name)
  and exists (
    select 1 from public.messages m
    where m.storage_path = name
      and m.deleted_at is null
      and public.is_conversation_member(m.conversation_id)
  )
);

drop policy if exists "Uploaders can delete their own conversation media" on storage.objects;
create policy "Uploaders can delete their own conversation media"
on storage.objects for delete to authenticated
using (
  bucket_id = 'kinfolk-media'
  and owner_id = (select auth.uid())::text
  and public.is_conversation_media_path(name)
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
  and not exists (
    select 1 from public.messages m
    where m.storage_path = name and m.deleted_at is null
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_deletions'
  ) then
    alter publication supabase_realtime add table public.message_deletions;
  end if;
end;
$$;
