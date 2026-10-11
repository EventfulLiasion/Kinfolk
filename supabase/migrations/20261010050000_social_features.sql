-- Kinfolk social screens: shared profile details and expiring circle updates.
-- Apply this migration in Supabase SQL Editor after the existing migrations.

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_path text;

grant select (id, display_name, bio, avatar_path), update (display_name, bio, avatar_path)
  on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kinfolk-avatars', 'kinfolk-avatars', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Circle members can view profile photos" on storage.objects;
create policy "Circle members can view profile photos"
on storage.objects for select to authenticated
using (
  bucket_id = 'kinfolk-avatars'
  and array_length(storage.foldername(name), 1) = 1
  and (
    split_part(name, '/', 1) = (select auth.uid())::text
    or exists (
      select 1
      from public.conversation_members mine
      join public.conversation_members peer on peer.conversation_id = mine.conversation_id
      where mine.user_id = (select auth.uid())
        and peer.user_id::text = split_part(name, '/', 1)
    )
  )
);

drop policy if exists "Users can upload their own profile photos" on storage.objects;
create policy "Users can upload their own profile photos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kinfolk-avatars'
  and array_length(storage.foldername(name), 1) = 1
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists "Users can delete their own profile photos" on storage.objects;
create policy "Users can delete their own profile photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'kinfolk-avatars'
  and array_length(storage.foldername(name), 1) = 1
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create table if not exists public.status_updates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 500),
  media_path text,
  content_type text not null default 'text' check (content_type in ('text', 'image', 'video')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint status_update_content_consistency check (
    (content_type = 'text' and media_path is null)
    or (content_type in ('image', 'video') and media_path is not null)
  )
);

-- Allow private storage reads for media referenced by an active status. The
-- preceding attachment migration intentionally restricts this bucket to
-- undeleted message attachments; status objects need their own equally scoped
-- read policy while their status row is active.
drop policy if exists "Circle members can view active status media" on storage.objects;
create policy "Circle members can view active status media"
on storage.objects for select to authenticated
using (
  bucket_id = 'kinfolk-media'
  and array_length(storage.foldername(name), 1) = 2
  and public.is_conversation_media_path(name)
  and exists (
    select 1
    from public.status_updates s
    where s.media_path = name
      and s.conversation_id::text = split_part(name, '/', 1)
      and s.user_id::text = split_part(name, '/', 2)
      and s.expires_at > now()
      and public.is_conversation_member(s.conversation_id)
  )
);

create index if not exists status_updates_circle_expiry_idx
  on public.status_updates(conversation_id, expires_at desc, created_at desc);
create index if not exists status_updates_author_created_idx
  on public.status_updates(user_id, created_at desc);

alter table public.status_updates enable row level security;

drop policy if exists "Conversation members can view active status updates" on public.status_updates;
create policy "Conversation members can view active status updates"
on public.status_updates for select to authenticated
using (
  expires_at > now()
  and public.is_conversation_member(conversation_id)
);

drop policy if exists "Members can post their own status updates" on public.status_updates;
create policy "Members can post their own status updates"
on public.status_updates for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
  and expires_at > now()
  and expires_at <= now() + interval '24 hours'
  and (
    media_path is null
    or (
      split_part(media_path, '/', 1) = conversation_id::text
      and split_part(media_path, '/', 2) = (select auth.uid())::text
    )
  )
);

drop policy if exists "Authors can delete their status updates" on public.status_updates;
create policy "Authors can delete their status updates"
on public.status_updates for delete to authenticated
using (user_id = (select auth.uid()) and public.is_conversation_member(conversation_id));

revoke all on public.status_updates from public, anon, authenticated;
grant select, insert, delete on public.status_updates to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'status_updates'
  ) then
    alter publication supabase_realtime add table public.status_updates;
  end if;
end;
$$;
