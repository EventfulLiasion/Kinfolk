-- Kinfolk attachment messages. Apply after 20261010000000_initial_schema.sql.
alter table public.messages
  add column if not exists content_type text not null default 'text',
  add column if not exists storage_path text,
  add column if not exists attachment_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint;

alter table public.messages
  drop constraint if exists messages_attachment_consistency;

alter table public.messages
  add constraint messages_attachment_consistency check (
    (
      content_type = 'text'
      and storage_path is null
      and attachment_name is null
      and mime_type is null
      and file_size is null
    )
    or
    (
      content_type in ('image', 'video', 'audio', 'file')
      and storage_path is not null
      and attachment_name is not null
      and mime_type is not null
      and file_size between 1 and 52428800
    )
  );

create index if not exists messages_attachments_idx
  on public.messages(conversation_id, created_at desc)
  where storage_path is not null;

