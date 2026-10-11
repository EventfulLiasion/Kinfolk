# Kinfolk

Kinfolk is a private, invite-only messaging app for a small circle. The first milestone uses Supabase Auth, PostgreSQL Row Level Security, and Realtime Postgres Changes. It does not use mocked message sending.

## Supabase setup

1. Create a Supabase project.
2. In **Project Settings → API**, copy the project URL and publishable key. Copy `.env.example` to `.env.local` and fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. This browser key is public; never use or expose a secret/service-role key.
3. In **SQL Editor**, run the migrations in order: `20261010000000_initial_schema.sql`, `20261010010000_message_attachments.sql`, `20261010020000_fix_private_media_upload_policy.sql`, `20261010030000_message_deletion.sql`, `20261010040000_one_to_one_calls.sql`, `20261010050000_social_features.sql`, then `20261010060000_status_media_access.sql`. The social migration adds private profile photos/bios, the avatar bucket, and 24-hour updates. The status-media migration allows conversation members to read media referenced by active statuses while keeping the existing bucket private.
   - If earlier migrations are already applied, run only the new migrations that have not been applied yet.
4. In **Authentication → Providers**, enable Email. For quick two-person testing, either keep email confirmation enabled and confirm both sign-up links, or disable confirmation only if appropriate for your private test project.
5. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow that URL as a redirect. Add your deployed Kinfolk URL there before testing from your sister’s device.
6. Start Kinfolk with `npm run dev`. Create an account on each device. In each account, copy the invite code from the profile panel and use it on the other account to connect. Conversation membership is created through a database function; client-side table inserts cannot add members.
7. In LiveKit Cloud, create a project and copy its WebSocket URL, API key, and API secret into `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in `.env.local`. These values are server-only; never add a `NEXT_PUBLIC_` prefix and never commit `.env.local`. Restart Next.js after changing them.

## Local development

```bash
npm install
npm run dev
```

Production compilation: `npm run build`; run the result with `npm start`.

## Privacy model

All conversation, membership, profile, message, message-deletion, status-update, and call-session tables use RLS. Users can read messages and active updates only when they are conversation members. Delete-for-me rows are scoped to their owner. Delete-for-everyone is performed by a security-definer function that checks the authenticated sender and conversation membership, then tombstones the shared row. Private media objects are scoped to conversation members; the token endpoint verifies the Supabase bearer session, call session, and conversation membership before signing a short-lived LiveKit token. LiveKit API secrets remain server-side. No service-role key is needed by this app.

## Current milestone boundaries

Email/password authentication, invite-only direct messaging, persistent history, realtime message updates, attachment sharing with captions, per-user/shared deletion, LiveKit one-to-one calls and call history, shared-media browsing, editable profiles, and private 24-hour status updates are included. Calls require the SQL migrations and server-only LiveKit credentials above, plus camera/microphone permission in a secure browser context (HTTPS or localhost). Cross-device messaging, updates, media, and calling still require testing with two configured accounts and devices; a successful build alone does not prove they work.

