# Wstorage

Internal Digital Asset Management. Next.js 15 (App Router) + Supabase (Auth + Postgres) + Backblaze B2 (S3-compatible) storage, with an encrypted, dashboard-managed multi-key system.

## What's in this build

**Working end-to-end:**
- Invite-only auth + RBAC scaffold (`super_admin` / `admin` / `employee`).
- **Storage abstraction layer** (`src/lib/storage`) — the app never talks to B2 directly. Add R2/S3/GCS later by implementing one interface.
- **Backblaze B2 provider** over the S3-compatible API (presigned upload + presigned download).
- **Dashboard-managed storage keys** — add multiple B2 keys, mark one active, revoke the old one. Secrets are AES-256-GCM encrypted before hitting the DB and are never returned to the browser.
- **Presigned direct upload** — large files go browser → B2, bypassing Vercel's 4.5 MB function body limit. Client computes SHA-256 for duplicate detection.
- **Signed-URL downloads** — every download goes through an authenticated route that logs the event and 307-redirects to a 60–300s signed URL. No permanent links ever leave the server.
- Full Postgres schema + RLS (`supabase/migrations`).

**Scaffolded / plug-in points (tables + APIs exist, UI is minimal):**
Analytics widgets, version-restore UI, folders tree, collections, favorites UI, user-management UI, bulk operations. The data layer for these already records everything (`activity_logs`, `downloads`, `file_versions`).

## Setup

### 1. Install
```bash
npm install
```

### 2. Supabase (shared project — safe alongside other products)

Wstorage lives entirely in its own **`wstorage` Postgres schema**. The migrations create
nothing in `public`, so they can't touch other products' tables in the same project. The
only shared object is one uniquely-named trigger on `auth.users` (`wstorage_on_auth_user_created`).

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
