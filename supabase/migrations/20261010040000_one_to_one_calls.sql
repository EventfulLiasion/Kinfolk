-- Authenticated, one-to-one call signaling. LiveKit transports media separately.
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  call_type text not null check (call_type in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'declined', 'missed', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  constraint call_sessions_distinct_users check (caller_id <> callee_id)
);
alter table public.call_sessions add column if not exists updated_at timestamptz not null default now();

create unique index if not exists call_sessions_one_open_per_conversation
  on public.call_sessions(conversation_id)
  where status in ('ringing', 'active');
create index if not exists call_sessions_conversation_created_idx
  on public.call_sessions(conversation_id, created_at desc);

alter table public.call_sessions enable row level security;
drop policy if exists "Conversation members can view call sessions" on public.call_sessions;
create policy "Conversation members can view call sessions"
on public.call_sessions for select to authenticated
using (public.is_conversation_member(conversation_id));

revoke all on public.call_sessions from public, anon, authenticated;
grant select on public.call_sessions to authenticated;

create or replace function public.start_direct_call(target_conversation uuid, requested_type text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  callee uuid;
  new_call uuid;
begin
  if caller is null or requested_type not in ('audio', 'video') then
    raise exception 'Authentication and a valid call type are required.' using errcode = '42501';
  end if;
  if not public.is_conversation_member(target_conversation) then
    raise exception 'You are not a member of this conversation.' using errcode = '42501';
  end if;

  select cm.user_id into callee
  from public.conversation_members cm
  where cm.conversation_id = target_conversation and cm.user_id <> caller
  limit 1;
  if callee is null or (select count(*) from public.conversation_members cm where cm.conversation_id = target_conversation) <> 2 then
    raise exception 'Calls require a direct two-person conversation.' using errcode = '22023';
  end if;

  update public.call_sessions
  set status = 'missed', ended_at = now()
  where status = 'ringing'
    and (caller_id in (caller, callee) or callee_id in (caller, callee))
    and created_at < now() - interval '60 seconds';
  update public.call_sessions
  set status = 'ended', ended_at = now()
  where status = 'active'
    and (caller_id in (caller, callee) or callee_id in (caller, callee))
    and updated_at < now() - interval '2 minutes';

  if exists (
    select 1 from public.call_sessions cs
    where cs.status in ('ringing', 'active')
      and (cs.caller_id in (caller, callee) or cs.callee_id in (caller, callee))
  ) then
    raise exception 'You or your sister is already in a call.' using errcode = '55P03';
  end if;

  begin
    insert into public.call_sessions(conversation_id, caller_id, callee_id, call_type)
    values (target_conversation, caller, callee, requested_type)
    returning id into new_call;
  exception when unique_violation then
    raise exception 'This conversation already has an active call.' using errcode = '55P03';
  end;
  return new_call;
end;
$$;

create or replace function public.accept_direct_call(target_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  call_row public.call_sessions%rowtype;
begin
  select * into call_row from public.call_sessions where id = target_call for update;
  if not found or call_row.callee_id <> caller then
    raise exception 'Incoming call not found for this account.' using errcode = '42501';
  end if;
  if call_row.status <> 'ringing' then return false; end if;
  if call_row.created_at < now() - interval '60 seconds' then
    update public.call_sessions set status = 'missed', ended_at = now() where id = target_call;
    return false;
  end if;
  update public.call_sessions set status = 'active', accepted_at = now(), updated_at = now() where id = target_call;
  return true;
end;
$$;

create or replace function public.decline_direct_call(target_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  update public.call_sessions
  set status = 'declined', ended_at = now()
  where id = target_call and callee_id = caller and status = 'ringing';
  if found then return true; end if;
  if exists (select 1 from public.call_sessions where id = target_call and callee_id = caller) then return false; end if;
  raise exception 'Incoming call not found for this account.' using errcode = '42501';
end;
$$;

create or replace function public.expire_direct_call(target_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  update public.call_sessions
  set status = 'missed', ended_at = now()
  where id = target_call and callee_id = caller and status = 'ringing'
    and created_at < now() - interval '60 seconds';
  if found then return true; end if;
  if exists (select 1 from public.call_sessions where id = target_call and callee_id = caller) then return false; end if;
  raise exception 'Incoming call not found for this account.' using errcode = '42501';
end;
$$;

create or replace function public.end_direct_call(target_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  update public.call_sessions
  set status = 'ended', ended_at = now()
  where id = target_call
    and caller in (caller_id, callee_id)
    and status in ('ringing', 'active');
  if found then return true; end if;
  if exists (select 1 from public.call_sessions where id = target_call and caller in (caller_id, callee_id)) then return false; end if;
  raise exception 'Call not found for this account.' using errcode = '42501';
end;
$$;

create or replace function public.touch_direct_call(target_call uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  update public.call_sessions
  set updated_at = now()
  where id = target_call and caller in (caller_id, callee_id) and status = 'active';
  return found;
end;
$$;

revoke all on function public.start_direct_call(uuid, text) from public, anon;
revoke all on function public.accept_direct_call(uuid) from public, anon;
revoke all on function public.decline_direct_call(uuid) from public, anon;
revoke all on function public.expire_direct_call(uuid) from public, anon;
revoke all on function public.end_direct_call(uuid) from public, anon;
revoke all on function public.touch_direct_call(uuid) from public, anon;
grant execute on function public.start_direct_call(uuid, text) to authenticated;
grant execute on function public.accept_direct_call(uuid) to authenticated;
grant execute on function public.decline_direct_call(uuid) to authenticated;
grant execute on function public.expire_direct_call(uuid) to authenticated;
grant execute on function public.end_direct_call(uuid) to authenticated;
grant execute on function public.touch_direct_call(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end;
$$;
