-- Kinfolk uploads are stored as <conversation UUID>/<uploader UUID>/<filename>.
-- storage.foldername() excludes the filename, so this path has exactly two folders.
-- The previous >= 3 predicate rejected every upload from the current client.
drop policy if exists "Members can upload their own conversation media" on storage.objects;

create policy "Members can upload their own conversation media"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'kinfolk-media'
  and public.is_conversation_media_path(name)
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and array_length(storage.foldername(name), 1) = 2
);
