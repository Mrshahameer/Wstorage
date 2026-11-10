# Wstorage architecture

The detailed reference. Start with [`CLAUDE.md`](../CLAUDE.md) for the short version and the
working rules.

## 1. System overview

```
Browser (Next.js pages, React client components)
   │  fetch /api/*            presigned PUT / GET (file bytes never pass through Vercel)
   ▼                                    ▲
Vercel serverless (Next.js route handlers) ───────────────┐
   │  service-role Supabase client (schema wstorage)       │ signs URLs with the active storage key
   ▼                                                       ▼
Supabase Postgres + Auth                          Cloudflare R2 / Backblaze B2
   │
   └── AI Search Assistant ──► Google AI Studio (Gemini)  ──► Groq (backup)
```

- Auth: Supabase Auth (invite only). `src/middleware.ts` refreshes the session and redirects
  signed-out users to `/login`, except public paths (`/login`, `/share`, `/api/share`).
- Every API route checks the user with `requireUser()` or `requireRole(min)` from
  `src/lib/auth.ts`, then reads with the service-role client. Non-admin visibility always goes
  through `accessScope()` in `src/lib/access.ts`.
- Uploads: `POST /api/upload/presign` returns a presigned PUT URL, the browser uploads directly
  to storage, then `POST /api/upload/complete` records the file. Downloads go through
  `/api/download/[fileId]`, which logs the download and redirects to a short-lived signed URL.

## 2. Data model (schema `wstorage`)

| Table | Purpose |
|---|---|
| `profiles` | One row per user: email, role, active flag, upload/edit/delete/download flags. |
| `categories` › `verticals` › `campaigns` | The taxonomy. Campaigns have a `campaign_type_id` (`campaign_types`: Live Transfer, Warm Transfer, Pure Inbound, …). |
| `folders` | Resource folders. `campaign_id` ties a folder to its campaign; `parent_id` allows nesting; `sort` orders them. |
| `files` | Assets. `folder_id`, `campaign_id`, `vertical_id`, `category_id`, `tags[]`, `extension`, `content_type`, `size_bytes`, `live_url`, `status` (`ready` when uploaded), `is_archived`, `created_at`, `updated_at`. |
| `file_versions`, `downloads`, `activity_logs` | History and audit. |
| `folder_access`, `category_access`, `user_resource_permissions` | Grants. `accessScope()` expands category to verticals to campaigns, and folders to their subfolders. |
| `share_links`, `share_link_resources` | Public links (optional password, expiry, download limits). Vertical and category shares are expanded to campaigns when created. |
| `storage_keys`, `key_requests` | Encrypted storage credentials (one active per provider) and personal key requests. |
| `ai_keys`, `ai_settings` | Encrypted AI keys (rotation, cooldown) and the singleton settings row (enabled, provider order, Gemini model chain, Groq model). Migration 0008. |
| `ai_calls`, `ai_feedback` | One row per model request (status, latency, error) and thumbs up/down on replies. Migration 0009. |

Migrations live in `supabase/migrations/` and are run by hand in the Supabase SQL editor:
`0001_schema` · `0002_rls` · `0003_access_and_fixes` · `0004_personal_keys_and_access` ·
`0005_add_r2_provider` · `0006_campaign_intelligence` · `0007_folder_sort` ·
`0008_ai_assistant` · `0009_ai_observability`.

## 3. Roles and access

`client(1) < employee(2) < bd_manager(3) < manager(4) < admin(5) < super_admin(6)`.

- Admins and super admins see everything.
- Everyone else sees: files with no folder (shared pool), plus everything under their grants
  (category, vertical, campaign or folder, with inheritance).
- BD manager and up can create public share links, limited to what they can access.

## 4. Pages

| Path | Who | What |
|---|---|---|
| `/login` | public | Sign in. |
| `/dashboard` | signed in | Home with quick stats. |
| `/library` | signed in | Category › Vertical › Campaign › Folder browser. Deep links: `?campaignId=…&folderId=…`. |
| `/files` | signed in | Search and filter all assets. |
| `/files/[id]` | signed in | Asset page: preview, details, download, share. |
| `/assistant` | signed in | AI Search Assistant chat. History is kept per user in the browser until sign-out. |
| `/shared` | signed in | Assets shared with the user. |
| `/settings/users`, `/settings/roles` | super admin | Users and granular permissions. |
| `/settings/categories`, `/settings/campaigns`, `/settings/folders` | admin | Taxonomy management. |
| `/settings/storage-keys` | admin | Storage credentials. |
| `/settings/share-links` | BD manager+ | Share links they created. |
| `/settings/ai` | admin | AI Control: keys (bulk add, Test), usage, model chain, bad answers. |
| `/settings/activity` | super admin | Activity log. |
| `/share/[token]` | public | Shared assets grouped by campaign and folder, optional password. |

### Responsive layout

Phones (below 768px) get `MobileNav`: a sticky top bar (menu, logo, assistant shortcut) and a
slide-out panel with the same links, the user, sign-out and the version. From 768px the sidebar
is fixed at 240px. List screens switch from cards to tables only where the table fits beside the
sidebar (`stack-sm` below 1024px, `stack-xl` below 1280px; Search and Users use the same
thresholds). Contributor rules are in `CLAUDE.md` under "Mobile and responsive rules".

## 5. API endpoints

Generated from the code (`export async function GET/POST/…` and the auth call in each handler).
"signed in" means any active user, `x+` means that role or higher.

| Endpoint | Methods (auth) | Purpose |
|---|---|---|
| `/api/activity` | GET (super_admin+) | Activity log feed. |
| `/api/analytics` | GET (super_admin+) | Dashboard analytics. |
| `/api/ai-keys` | GET, POST, PATCH (admin+) | List keys + settings + model chain + 24h usage + bad answers. Add one or many keys (one per line). Update provider order, enabled, models. |
| `/api/ai-keys/[id]` | DELETE (admin+) | Remove a key. |
| `/api/ai-keys/[id]/test` | POST (admin+) | Send one tiny request with this key; reports ok, quota, rate limit or rejected. |
| `/api/assistant/search` | POST (signed in) | The assistant. Body `{ query (≤ 4,000 chars), history[] }`. Returns `{ reply, sections[], meta }`. |
| `/api/assistant/feedback` | POST (signed in) | Thumbs up or down on a reply. |
| `/api/campaign-types` | GET (signed in), POST (admin+) | Campaign types. |
| `/api/campaigns` | GET (signed in), POST (admin+) | Campaigns (`?verticalId=`, `?scope=accessible`). |
| `/api/categories` | GET (signed in), POST (admin+) | Categories. |
| `/api/categories/[id]` | PATCH, DELETE (admin+) | Edit or delete a category. |
| `/api/verticals` | GET (signed in), POST (admin+) | Verticals (`?categoryId=`). |
| `/api/resource-types` | GET (signed in), POST (admin+) | Resource types. |
| `/api/folders` | GET (signed in), POST (admin+) | Folders (`?campaignId=` top level, `?parentId=` children, `?scope=accessible`). |
| `/api/folders/[id]` | PATCH, DELETE (admin+) | Edit or delete a folder. |
| `/api/library-path` | GET (signed in) | Resolve `campaignId` (+ `folderId`) to the full breadcrumb, for deep links. |
| `/api/files` | GET (signed in) | Search and filter files (access-filtered). |
| `/api/files/[id]` | GET (signed in), DELETE (admin+) | One file; delete. |
| `/api/files/[id]/preview` | GET (signed in) | Short-lived inline URL for previews (images, audio). |
| `/api/download/[fileId]` | GET (signed in) | Logged download, redirects to a signed URL. |
| `/api/upload/presign` | POST (admin+) | Presigned upload URL. |
| `/api/upload/complete` | POST (admin+) | Record an uploaded file. |
| `/api/share-links` | GET, POST (bd_manager+) | List and create share links (files, folders, campaigns, verticals, categories). |
| `/api/share-links/[id]` | PATCH, DELETE (bd_manager+) | Edit or revoke a link. |
| `/api/share/[token]` | POST (public) | Open a share link (password in body). |
| `/api/share/[token]/download` | POST (public) | Download one shared file. |
| `/api/storage-keys` | GET, POST (admin+) | Storage credentials. |
| `/api/storage-keys/[id]` | PATCH, DELETE (admin+) | Activate or revoke. |
| `/api/storage-keys/cors` | POST (admin+) | Apply bucket CORS. |
| `/api/key-requests` | GET, POST (signed in) | Personal storage key requests. |
| `/api/key-requests/[id]/approve` | POST (super_admin+) | Approve a request. |
| `/api/permissions` | GET (admin+), POST (super_admin+) | Granular grants for a user. |
| `/api/users` | GET (admin+), POST (super_admin+) | List and invite users. |
| `/api/users/[id]` | PATCH, DELETE (super_admin+) | Edit or remove a user. |

## 6. AI Search Assistant

Files: `src/lib/assistant/{types,catalog,data,match,tools,providers,agent,fallback,log}.ts`,
`src/app/api/assistant/search/route.ts`, `src/components/search-assistant.tsx`.

### 6.1 Request flow

```
POST /api/assistant/search { query, history }
  1. loadCatalog(user)              data.ts    paged reads, 30 s cache, access-scoped
  2. AI on?  runAgent(...)          agent.ts   system prompt = rules + catalogText(catalog)
       ├─ model replies with text                       → done (1 call)
       └─ model calls tools ─► runTool() ─► real queries → results back to model → reply (2 calls)
  3. Every key/model failed?  planFallback(catalog, query)  fallback.ts → same tools
  4. Response { reply, sections[], meta { mode: ai|keyword, model, steps, ms, reason } }
  5. after(): write the model-call log to ai_calls (does not delay the reply)
```

### 6.2 The catalog

`buildCatalog(rows, scope)` (pure, tested) produces one entry per accessible campaign with a
short ref (`C1`, `C2`, … sorted by category, vertical, name), its type, and its top-level
folders with real file counts (subfolders roll up into their top folder). Non-admins see only
granted campaigns, or only granted folders of a campaign. `catalogText()` renders it at about
30 tokens per campaign, so the whole library fits in every request.

### 6.3 Tools (`tools.ts`)

| Tool | Args | Returns |
|---|---|---|
| `get_assets` | `items[]` of `{ campaign: ref, folder?: name }` | One files section per item: up to 60 newest files with name, size, created and updated dates, tags, live URL, plus the true total. Missing folder or unknown ref becomes a visible note. |
| `find_missing` | `folder`, optional `vertical` / `category` | Campaigns whose matching folder is absent or empty. |
| `search_files` | `text`, optional `campaigns[]` | Files whose name, description or tags match (not file contents), grouped by campaign. |
| `show_campaigns` | `campaigns[]`, optional `title` | Campaign cards that open the library. |

Every ref is resolved against the caller's catalog, so the model cannot reach anything the
user cannot see.

### 6.4 Providers and failover

- `providers.ts`: Gemini `generateContent` with `functionDeclarations` (the model's turn is kept
  verbatim so Gemini 3 thought signatures carry into the next round), and Groq's
  OpenAI-compatible tool calls. 15 second timeout per call.
- Errors are classified: `quota` (daily limit), `rate_limited` (per minute), `overloaded`
  (5xx), `timeout`, `auth` (rejected key), `bad_output`, `error`.
- `agent.ts`: for each provider in order, for each key (least recently used, not cooling down),
  try each model in the chain. A key and model pair is skipped for 1 hour after a quota error,
  1 minute after a rate limit, 2 minutes after an overload or timeout. A rejected key is not
  retried for its other models. A 40 second overall budget. If tools already ran when a later
  step fails, their results are kept and the server writes the reply.
- Default Gemini chain (`DEFAULT_GEMINI_MODEL` in `ai-keys.ts`, editable in AI Control):
  `gemini-3.5-flash-lite, gemini-flash-lite-latest, gemini-3.1-flash-lite, gemini-flash-latest`.
  Gemma is excluded (no tool calling).

### 6.5 Limits and capacity

Free Gemini limits are per Google Cloud project, per model, per day (reset at midnight Pacific),
plus per-minute limits. Keys from the same project share one limit. A question uses 1 model call,
or 2 when it fetches assets. To add capacity: add keys from different projects, lengthen the
model chain, add a Groq key, or enable billing on a project.

### 6.6 Keyword mode (`fallback.ts`)

Same catalog, same tools, no model. Splits multi-part messages (protecting names that contain
"and" or "&"), carries a vertical to the parts that follow it, matches campaign types
("live transfer", "inbound"), and answers counts, lists, overviews and gaps directly. Best
effort for complex phrasing; the AI path is primary.

### 6.7 Quality loop

- `npm test`: 25 offline tests (catalog, access scoping, matching, every tool, fallback plans,
  agent failover, error classification) on the fixture library in `tests/fixtures/library.ts`.
- `npm run eval:assistant` (needs `GEMINI_API_KEY`): real models, real prompt, checks the tools
  and refs chosen for multi-part, cross-vertical, gap, count, greeting and search questions.
- Thumbs-down replies appear in AI Control; add them as eval cases.

### 6.8 Chat UI

`search-assistant.tsx`: numbered sections per part, file rows with image thumbnails (loaded
when visible), in-place audio playback for recordings, live-page links, download, copy link,
"Copy all links" and share per section, a status line per reply (AI model and time, or keyword
mode and why), thumbs up and down. The chat lives in a per-user store outside the component, so
switching tabs keeps it (including a reply that arrives meanwhile), and it is saved in
`localStorage` until sign-out. Messages are limited to 4,000 characters with a live counter.

## 7. Environment variables

| Name | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` (or `SUPABASE_URL`) | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key) | Browser and middleware auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role client. |
| `APP_ENCRYPTION_KEY` | 32-byte base64 key for encrypting storage and AI keys. Changing it makes stored keys unreadable. |
| `SIGNED_URL_TTL_SECONDS` | Lifetime of signed download and preview URLs. |
| `VERCEL_GIT_COMMIT_SHA` | Set by Vercel; shown as the version in the sidebar. |

AI keys are not environment variables. Admins add them in AI Control (encrypted in the DB).

## 8. Deploy and verify

1. Branch, change, then `npx tsc --noEmit`, `npm test`, `npx next build` (and the live eval for
   assistant changes).
2. Commit as the repo owner (see `CLAUDE.md`), push, open a PR, merge. Vercel deploys `main`.
3. Run any new migration in the Supabase SQL editor.
4. Check the sidebar version matches the merged commit, then test in the app.
