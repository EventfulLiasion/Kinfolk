-- Kinfolk: private, invite-only direct messaging foundation.
-- Apply this complete file in Supabase Dashboard → SQL Editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Kinfolk member',
  invite_code uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete restrict,
  direct_user_low uuid not null references auth.users(id) on delete cascade,
  direct_user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint direct_users_are_distinct check (direct_user_low < direct_user_high),
  constraint conversations_direct_pair_unique unique (direct_user_low, direct_user_high)
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists conversation_members_user_idx on public.conversation_members(user_id, conversation_id);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at desc);

create or replace function public.is_conversation_member(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = target_conversation
      and cm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create or replace function public.create_direct_conversation(requested_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  partner_id uuid;
  lower_id uuid;
  upper_id uuid;
  result_id uuid;
begin
  if caller_id is null then
    raise exception 'You must be signed in to connect.' using errcode = '28000';
  end if;

  select p.id into partner_id
  from public.profiles p
  where p.invite_code = requested_invite;

  if partner_id is null then
    raise exception 'That invite code was not found.' using errcode = '22023';
  end if;
  if partner_id = caller_id then
    raise exception 'You cannot start a conversation with yourself.' using errcode = '22023';
  end if;

  lower_id := least(caller_id, partner_id);
  upper_id := greatest(caller_id, partner_id);

  insert into public.conversations (created_by, direct_user_low, direct_user_high)
  values (caller_id, lower_id, upper_id)
  on conflict (direct_user_low, direct_user_high) do nothing
  returning id into result_id;

  if result_id is null then
    select c.id into result_id
    from public.conversations c
    where c.direct_user_low = lower_id and c.direct_user_high = upper_id;
  end if;

  insert into public.conversation_members (conversation_id, user_id)
  values (result_id, caller_id), (result_id, partner_id)
  on conflict do nothing;

  return result_id;
end;
$$;

revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

create or replace function public.get_my_invite_code()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.invite_code from public.profiles p where p.id = (select auth.uid());
$$;

revoke all on function public.get_my_invite_code() from public, anon;
grant execute on function public.get_my_invite_code() to authenticated;

create or replace function public.handle_new_kinfolk_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 'Kinfolk member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_kinfolk on auth.users;
create trigger on_auth_user_created_kinfolk
  after insert on auth.users
  for each row execute procedure public.handle_new_kinfolk_user();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Profiles visible to self and conversation peers" on public.profiles;
create policy "Profiles visible to self and conversation peers"
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1 from public.conversation_members mine
    join public.conversation_members peer on peer.conversation_id = mine.conversation_id
    where mine.user_id = (select auth.uid()) and peer.user_id = profiles.id
  )
);

drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists "Members can view their conversations" on public.conversations;
create policy "Members can view their conversations"
on public.conversations for select to authenticated
using (public.is_conversation_member(id));

drop policy if exists "Members can view conversation memberships" on public.conversation_members;
create policy "Members can view conversation memberships"
on public.conversation_members for select to authenticated
using (user_id = (select auth.uid()) or public.is_conversation_member(conversation_id));

drop policy if exists "Members can read conversation messages" on public.messages;
create policy "Members can read conversation messages"
on public.messages for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can send their own messages" on public.messages;
create policy "Members can send their own messages"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_conversation_member(conversation_id)
);

-- Remove any broad default grants and restore only the operations used by this client.
revoke all on public.profiles, public.conversations, public.conversation_members, public.messages from public, anon, authenticated;
grant select (id, display_name), update (display_name) on public.profiles to authenticated;
grant select on public.conversations, public.conversation_members, public.messages to authenticated;
grant insert on public.messages to authenticated;

-- Private media bucket for the next sharing milestone. Store objects as
-- <conversation UUID>/<uploader UUID>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kinfolk-media',
  'kinfolk-media',
  false,
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/wav',
    'application/pdf', 'text/plain'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_conversation_media_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folder_id text := split_part(object_name, '/', 1);
begin
  if folder_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.is_conversation_member(folder_id::uuid);
end;
$$;

revoke all on function public.is_conversation_media_path(text) from public, anon;
grant execute on function public.is_conversation_media_path(text) to authenticated;

drop policy if exists "Members can view conversation media" on storage.objects;
create policy "Members can view conversation media"
on storage.objects for select to authenticated
using (bucket_id = 'kinfolk-media' and public.is_conversation_media_path(name));

drop policy if exists "Members can upload their own conversation media" on storage.objects;
create policy "Members can upload their own conversation media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kinfolk-media'
  and public.is_conversation_media_path(name)
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) >= 3
);

-- Realtime subscriptions use the same RLS-protected message SELECT policy.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

