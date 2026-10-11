-- Status media shares the private conversation-media bucket with attachments.
-- The attachment read policy allows only objects referenced by undeleted
-- messages, so status rows need a separate, equally private read policy.
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
