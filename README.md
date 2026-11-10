# Wstorage

Internal asset library for a lead-generation team: campaign creatives, landing pages, agent
scripts, call recordings, data samples and compliance docs, organized as
Category › Vertical › Campaign › Folder › Files.

**New here (human or agent)? Read [`CLAUDE.md`](CLAUDE.md) first**, then
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system, data model and every API
endpoint. Progress and next steps: [`docs/PROGRESS.md`](docs/PROGRESS.md).

## What's in this build

- Next.js 15 (App Router) on Vercel, Supabase (Auth + Postgres, own `wstorage` schema).
- Storage through one provider interface (`src/lib/storage`): Cloudflare R2 and Backblaze B2,
  with dashboard-managed, AES-256-GCM encrypted keys. Presigned direct uploads and logged,
  signed downloads.
- Roles: client, employee, BD manager, manager, admin, super admin, plus granular grants on
  categories, verticals, campaigns and folders.
- Campaign Library with deep links, a filterable asset search, asset pages with previews.
- Public share links (files, folders, campaigns, verticals, categories), optional password,
  grouped by campaign and folder.
- AI Search Assistant: the model reads the user's library catalog and calls tools that run real
  queries, so one message can ask for several assets across campaigns. Gemini first, Groq
  backup, unlimited admin-managed keys with failover, keyword mode when no model is reachable,
  usage and key health in Settings › AI Control.
- Tests: `npm test` (offline), `npm run eval:assistant` (live model eval).

## Setup

### 1. Install
```bash
npm install
```

### 2. Supabase (shared project — safe alongside other products)

Wstorage lives entirely in its own **`wstorage` Postgres schema**. The migrations create
nothing in `public`, so they can't touch other products' tables in the same project. The
only shared object is one uniquely-named trigger on `auth.users` (`on_auth_user_created_wstorage`).

1. Create (or reuse) a project at supabase.com.
2. In the SQL editor, run `supabase/migrations/0001_schema.sql`, then `0002_rls.sql`, then `supabase/seed.sql`.
3. **Expose the schema (required):** Settings → API → **Exposed schemas** → add `wstorage` → Save.
   Without this, the app's queries return `schema must be one of ...` errors.
4. Auth → Providers: keep email enabled, **disable public sign-ups** (turn off "Allow new users to sign up"). You invite users instead (Auth → Users → Invite).
5. Invite yourself, then in SQL run:
   ```sql
   update wstorage.profiles set role = 'super_admin' where email = 'you@company.com';
   ```

### 3. Environment
```bash
cp .env.example .env.local
npm run gen:key   # paste output into APP_ENCRYPTION_KEY
```
Fill in the Supabase URL + anon + service-role keys.

### 4. Backblaze B2 — create a RESTRICTED key (do NOT use a master key)
1. B2 → Buckets → create a **private** bucket.
2. App Keys → **Add a New Application Key**:
   - Allow access to **that one bucket** only.
   - Capabilities: `listFiles, readFiles, writeFiles, deleteFiles, shareFiles`.
   - Leave everything else off. No `deleteKeys`, no `deleteBuckets`, no `bypassGovernance`.
3. Copy the `keyID`, the `applicationKey` (shown once), the bucket ID/name, and the S3 region from the bucket's endpoint (`s3.us-west-004.backblazeb2.com` → region `us-west-004`).
4. Run `npm run dev`, log in, go to **Settings → Storage Keys**, and add the key there. (You can also seed it via `B2_*` env vars, but the dashboard is the intended path.)

### 5. Run
```bash
npm run dev
```

## Rotating a key (your requested flow)
Settings → Storage Keys → **Add key** (mark active) → **Revoke** the old one.
- New uploads immediately use the new active key.
- Files already stored under the revoked key stay downloadable, because each file remembers which key it lives on (`files.storage_key_id`) — as long as you don't delete that key inside Backblaze itself.

## Security model (why it's built this way)
- The browser only ever gets the **anon** Supabase key and is bound by RLS. All writes to files/storage go through server routes using the **service role** key.
- B2 secrets: encrypted at rest (`src/lib/crypto.ts`), decrypted only in-memory on the server when signing a URL. The dashboard reads a secret-free view (`storage_keys_safe`).
- Downloads: private bucket + short-lived signed URL + per-download audit log. A copied link dies in minutes.

## Deploy (Vercel)
Push to GitHub, import into Vercel, set all env vars from `.env.local` in Project Settings → Environment Variables. `APP_ENCRYPTION_KEY` must be identical across environments or previously-stored secrets won't decrypt.
