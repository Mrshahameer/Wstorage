# Wstorage — Deployment Guide

End-to-end, in order. Wstorage shares one Supabase project with your other product
(Webster Solutions) safely because it lives in its own `wstorage` Postgres schema.

---

## Part A — Supabase (database)

### A1. Run the SQL — you need BOTH files, not just one
In Supabase → **SQL Editor**, run these in order:

1. `supabase/migrations/0001_schema.sql`  ← schema, tables, functions, trigger, grants
2. `supabase/migrations/0002_rls.sql`     ← **required** — turns on Row Level Security

> Running only 0001 is NOT safe: the schema is exposed to the API and the
> `authenticated` role has table grants, so without 0002 any logged-in user could
> read/write your tables directly. 0002 locks that down. Run both.

3. `supabase/seed.sql`  ← optional (starter categories/folders)

None of these touch `public.*`, so your Webster tables are untouched.

### A2. Expose the schema (one click, required)
Settings → **API** → **Exposed schemas** → add `wstorage` → **Save**.
Without this, the app returns `schema must be one of ...` on every query.

### A3. Lock down sign-ups
Authentication → **Sign In / Providers** → turn **OFF** "Allow new users to sign up."
Wstorage is invite-only; you add users manually.

### A4. Grab your keys (Settings → API)
- Project URL
- `anon` public key
- `service_role` secret key

---

## Part B — Backblaze (storage)

### B1. Create a private bucket
B2 → Buckets → Create Bucket → **Private**.

### B2. Create a RESTRICTED application key (never a master key)
App Keys → Add a New Application Key:
- Access: **that one bucket only**
- Capabilities: `listFiles, readFiles, writeFiles, deleteFiles, shareFiles`
- Everything else OFF

Copy: `keyID`, `applicationKey` (shown once), bucket ID, bucket name, and the
region from the bucket's S3 endpoint (`s3.us-west-004.backblazeb2.com` → `us-west-004`).

You do NOT put these in env — you'll add them from the app dashboard after deploy.

---

## Part C — Vercel (hosting)

### C1. Import
Vercel → Add New → **Project** → Import `Mrshahameer/Wstorage`.

### C2. Configure
- **Framework Preset:** Next.js (auto-detected)
- **Root Directory:** leave as **`./`** (the repo root — do NOT pick a subfolder;
  `package.json` is at the top level)
- **Build/Output:** leave all defaults

### C3. Connect Supabase (one click) — this sets your env vars automatically
On the project, use Vercel's **Supabase integration** ("Connect Storage" / "Add
Integration" → Supabase → pick your project). It injects, among others:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

These are the exact names the app reads, so the connection "just works." Supabase
creds are **environment variables, not `vercel.json`** — don't put them in the JSON file.

### C4. Add the remaining env vars manually
Project → Settings → **Environment Variables**:
- `APP_ENCRYPTION_KEY` — generate locally with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and paste the output. Set it ONCE and never change it, or previously-stored Backblaze keys become undecryptable.
- `SIGNED_URL_TTL_SECONDS` = `180` (optional)

Leave all `B2_*` blank — you add the storage key from the dashboard.

### C5. Deploy
Hit **Deploy**. First build takes a couple minutes.

---

## Part D — First-run setup (after deploy)

1. Supabase → Authentication → Users → **Invite** yourself (your email).
2. Set the password via the invite email.
3. Promote yourself — Supabase SQL Editor:
   ```sql
   update wstorage.profiles set role = 'super_admin' where email = 'you@company.com';
   ```
4. Open your Vercel URL → **log in**.
5. Go to **Settings → Storage Keys** → add your restricted Backblaze key (label, keyID,
   applicationKey, bucket ID, bucket name, region) → mark **active**.
6. Go to **Files → Upload** and drop a test file. Confirm it appears in your B2 console.

Done. To rotate a B2 key later: add a new one (mark active), then revoke the old one —
no redeploy.

---

## Quick reference — env var names
| Variable | Set by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase integration | auto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase integration | auto |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase integration | auto, server-only |
| `APP_ENCRYPTION_KEY` | you | 32-byte base64, set once |
| `SIGNED_URL_TTL_SECONDS` | you | optional, default 180 |
| `B2_*` | leave blank | keys added via dashboard |
