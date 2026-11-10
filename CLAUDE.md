# Wstorage: ground truth for agents

Read this before changing anything. Deeper detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
(system design, every endpoint, data model, assistant internals). Session history and next
steps: [`docs/PROGRESS.md`](docs/PROGRESS.md). Setup and deploy: [`DEPLOYMENT.md`](DEPLOYMENT.md).

## What this is

Wstorage is an internal asset library for a lead-generation team (insurance, home services,
web leads). Staff find and share campaign assets: creatives, landing pages, agent scripts,
verification (call) recordings, data samples, TCPA and compliance docs.

The library is a fixed hierarchy:
**Category › Vertical › Campaign › Folder › Files.** Today: 3 categories, 35 verticals,
89 campaigns, 650 folders, up to about 2,000 files per client. Every campaign has the same
standard folders (Creatives, Landing Pages, Agent Scripts, Verification Recordings, Data
Samples, TCPA & Compliance, Other Assets), but code must never assume that list: folder names
come from the database.

Live app: https://websterassets.vercel.app (auto-deploys from `main`).

## Stack

| Layer | Choice |
|---|---|
| App | Next.js 15 App Router, TypeScript, Tailwind. Server routes in `src/app/api/**/route.ts`. |
| Hosting | Vercel. Every merge to `main` deploys. The sidebar shows the deployed commit (`Version abc1234`). |
| DB + Auth | Supabase Postgres, own schema `wstorage` (shares a project with another product, so never touch `public`). |
| Files | Cloudflare R2 or Backblaze B2 through `src/lib/storage` (one interface, presigned upload and download). |
| Secrets | Storage keys and AI keys are AES-256-GCM encrypted in the DB with `APP_ENCRYPTION_KEY` (32-byte base64, no `base64:` prefix). |
| AI | Google AI Studio (Gemini) first, Groq as backup. Admin-managed keys and model chain in Settings › AI Control. |

## Rules that prevent the usual breakages

1. **Run `npx tsc --noEmit` before every push.** `next.config.mjs` ignores type errors during
   the build, so a broken import still builds and then crashes in the browser.
2. **Run `npm test`** (offline unit tests, about 1 second). For any change to the assistant
   prompt, tools or matching, also run the live eval: `GEMINI_API_KEY=... npm run eval:assistant`.
3. **`tsconfig` is non-strict.** Discriminated unions do not narrow on `if (x.ok)`. Use flat
   result shapes (see `AgentResult` in `src/lib/assistant/agent.ts`) or explicit casts.
4. **Supabase returns at most 1,000 rows per request.** Any query that can exceed that must page
   (`selectAll` in `src/lib/assistant/data.ts`). Never `.in()` with hundreds of ids in one call;
   chunk to 100.
5. **The service-role client (`src/lib/supabase/admin.ts`) bypasses RLS.** It is server only.
   Every route must check the user (`requireUser` / `requireRole`) and filter by access
   (`accessScope` in `src/lib/access.ts`) for non-admins.
6. **Migrations are run by hand** in the Supabase SQL editor, in order, from
   `supabase/migrations/`. Code must keep working (degrade quietly) if the newest migration has
   not been run yet. Never edit an old migration; add a new numbered one.
7. **Commits and deploys:** Vercel only auto-deploys commits authored by the repo owner, so
   commit with the owner's git identity (copy it from `git log -1 --format='%an <%ae>'`) and do
   not add co-author trailers. Work on a branch, open a PR, merge it; `main` is what deploys.
8. **Do not hardcode library names** (verticals, campaigns, folder names). Match against the
   real names in the catalog. The only allowed fixed knowledge is phrasing hints such as
   "lander means landing page" (`src/lib/assistant/match.ts`).
9. **Never trust model output.** Every campaign ref or folder name the AI sends is validated
   against the user's own catalog before any query runs.

## Repo map

```
src/app/(dashboard)/   signed-in pages: dashboard, library, files (search), assistant, shared, settings/*
src/app/api/           route handlers (full list with auth in docs/ARCHITECTURE.md)
src/app/share/[token]  public share-link page (no login; optional password)
src/components/        client UI (campaign-library, search-assistant, files-browser, access-tree, …)
src/lib/auth.ts        session user, roles, requireUser / requireRole, activity log
src/lib/access.ts      what a non-admin may see (grants expanded to campaigns and folders)
src/lib/permissions.ts per-file and per-resource checks
src/lib/storage/       R2 and B2 providers behind one interface
src/lib/ai-keys.ts     AI keys (encrypted), settings, model chain, key rotation and cooldown
src/lib/assistant/     the AI Search Assistant (see below)
supabase/migrations/   0001 to 0009, run in order by hand
tests/                 offline unit tests + fixture library (npm test)
scripts/               eval-assistant.ts (live model eval)
docs/                  ARCHITECTURE.md, PROGRESS.md, PROJECT_PLAN.md
```

## Roles

`client < employee < bd_manager < manager < admin < super_admin` (`ROLE_ORDER` in
`src/lib/auth.ts`). BD manager and up can create public share links. Admin and up manage the
library, keys and AI. Super admin manages users, permissions, analytics and activity.

## The AI Search Assistant in one minute

Code: `src/lib/assistant/`. Endpoint: `POST /api/assistant/search`. Page: `/assistant`.

1. `data.ts` loads a **catalog** of everything this user can access (paged, cached 30 seconds,
   cleared by every write route). `catalog.ts` turns it into compact text: one line per campaign
   with a ref (`C12`), its category, vertical, type and file count per folder.
2. `agent.ts` sends the catalog plus the chat to the model with **native tool calling**
   (`providers.ts` for Gemini and Groq). The model answers questions straight from the catalog,
   or calls tools: `get_assets`, `find_missing`, `search_files`, `show_campaigns`
   (`tools.ts`). Several items in one call cover multi-part asks across campaigns.
3. Tools run real queries and return **sections** (files with dates, tags, links) for the UI
   and a short summary for the model, which then writes the reply (at most 3 rounds).
4. **Failover:** keys rotate; each key tries the model chain in order; a model that is out of
   quota, rate limited, overloaded or hanging is skipped for a while (circuit breaker); a
   rejected key is skipped. Free Gemini quota is per Google Cloud project and per model.
5. If every key and model fails, **keyword mode** (`fallback.ts`) answers from the same catalog
   and tools. The reply's status line always says which path answered and, in keyword mode,
   why (quota, overloaded, no keys…).
6. Every model call is logged to `wstorage.ai_calls` (migration 0009) and shown in AI Control
   (usage per model, last error, Test button per key). Thumbs-down replies land in
   `wstorage.ai_feedback`; turn real bad answers into cases in `scripts/eval-assistant.ts`.

To change behavior: prompt in `systemPrompt()` (`agent.ts`), tools in `tools.ts`, phrasing hints
in `match.ts`. Then run `npm test` and the live eval before shipping.
