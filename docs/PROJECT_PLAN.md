# Wstorage — Campaign Asset & Resource Management Portal
### Master Project Plan & Architecture Brief

> **Purpose of this document:** the single source of truth for what we are building, why,
> and in what order. It is written so that work can be **paused and resumed across sessions**
> (e.g. when an AI usage limit is hit and later resets). When you come back, read
> [`PROGRESS.md`](./PROGRESS.md) first to see exactly where we stopped, then return here for the detail.

- **Product name:** Wstorage
- **Owner / Super Admin:** shahmeerrehman333@gmail.com
- **Repo:** github.com/Mrshahameer/Wstorage
- **Last plan update:** 2026-08-21
- **Current phase:** Phase 1 built (core storage engine). Planning Phase 2+.

---

## 1. What this product is

A centralized, secure **Campaign Asset Management Portal** for a PPC / performance-marketing /
lead-generation / call-center business.

It stores, organizes, searches, controls access to, and distributes every campaign resource:
creatives, ad copy, scripts, call recordings, landing pages, campaign proofs, ad previews,
screenshots, sample leads, compliance docs, ZIPs, PDFs, images, videos, audio, external links.

**The problem it kills:** Business Development (BD) managers constantly ping the SMM/marketing
team asking "Do we have creatives for Auto Insurance?", "Can you send the recordings?",
"Is there a landing page for inbound roofing?". Instead, an authorized user logs in, searches
or browses to the campaign, and self-serves **only the resources they're permitted to see**.

**Design principle:** this is a *Campaign Resource Management System*, **not** a plain folder
store. Folders give humans an intuitive tree; the database underneath also understands
*vertical, campaign, campaign type, resource type, who can access, who downloaded, is it
shareable, when does access expire.*

---

## 2. Current state of the codebase (what already exists — 2026-08-21)

This matters for resuming: **do not rebuild what's already here.** The existing app is a working
storage engine. We are *extending* it toward the campaign-portal vision, not starting over.

### Stack (already chosen and in place)
- **Next.js 15** (App Router) + React 18 + TypeScript
- **Supabase** — Auth + Postgres, everything isolated in a dedicated `wstorage` schema
- **Object storage** via a provider abstraction: **Backblaze B2** and **Cloudflare R2** implemented
- **Tailwind CSS**. (No shadcn/ui yet — spec recommends it; optional.)
- Deploy target: **Vercel**

### Already working end-to-end
| Area | Status | Where |
|---|---|---|
| Invite/instant user creation, session auth | ✅ | `src/lib/auth.ts`, `src/middleware.ts`, `src/app/login` |
| RBAC: `super_admin` / `admin` / `employee` | ✅ | `wstorage.app_role` enum, `src/lib/auth.ts` |
| Storage abstraction (add providers via one interface) | ✅ | `src/lib/storage/{types,index,backblaze,r2}.ts` |
| Encrypted storage keys (AES-256-GCM), dashboard-managed, rotate/revoke | ✅ | `src/lib/crypto.ts`, `src/app/api/storage-keys/*` |
| Presigned **direct browser→bucket upload** (bypasses Vercel 4.5MB limit) | ✅ | `src/app/api/upload/presign`, `upload/complete` |
| SHA-256 client-side dedupe detection | ✅ | `upload-panel.tsx`, presign route |
| Signed-URL downloads w/ audit log + 307 redirect | ✅ | `src/app/api/download/[fileId]` |
| Recursive folders (`parent_id`) + categories | ✅ | `wstorage.folders`, `wstorage.categories` |
| **Per-category / per-folder / per-file access grants** | ✅ | `category_access`, `folder_access`, `file_access` tables |
| File versions table + record on upload | ✅ | `wstorage.file_versions` |
| Activity log + downloads log tables | ✅ | `wstorage.activity_logs`, `downloads` |
| Favorites + collections (tables only, minimal UI) | ⚠️ scaffold | schema present |
| Multi-field search (name/tags/ext/description) + tag badges | ✅ | `files-browser.tsx`, `api/files` |
| Key-request approval workflow + personal-key wizard | ✅ | `key-requests`, `personal-key-wizard.tsx` |
| One-click CORS enable for browser uploads (B2 + R2) | ✅ | `src/lib/*-cors.ts`, `api/storage-keys/cors` |
| RLS across the `wstorage` schema | ✅ | `supabase/migrations/0002_rls.sql` |

### Migrations present
`0001_schema` (core) · `0002_rls` · `0003_access_and_fixes` (folder_access) ·
`0004_personal_keys_and_access` (category_access, file_access, key_requests) ·
`0005_add_r2_provider`.

### Known issues to fix early
- **BUG:** `src/middleware.ts` declares `type CookieToSet` **twice** (lines ~9 and ~11) — a
  duplicate-identifier error that will fail `next build`. Fix before any deploy.
- The live GitHub PAT that was shared to seed this repo should be **rotated** (treat as leaked).

---

## 3. Gap analysis — existing vs. target vision

| Capability (from spec) | Today | Work needed |
|---|---|---|
| Recursive unlimited hierarchy | ✅ folders.parent_id | Keep. Add semantic tagging on top. |
| Category → Vertical → Campaign Type → Campaign semantic layer | ❌ generic folders only | Add `vertical`, `campaign_type`, `campaign` fields/tables (hybrid model, §5). |
| Resource types (Creative, Recording, Script, Landing Page…) | ❌ | Add `resource_type` enum + column on assets. |
| Granular permissions (VIEW/DOWNLOAD/UPLOAD/EDIT/DELETE/SHARE/MANAGE_ACCESS) | ⚠️ grant = "can see" only | Add action-level permission model (§6). |
| BD Manager + Client roles | ❌ (3 roles) | Extend role enum + UI. |
| Public / private **share links** | ❌ | New: `share_links` + `share_link_items`, public route, password, expiry, download cap. **Highest-value gap.** |
| Landing-page asset type (URL + screenshot + source ZIP) | ❌ | Special asset type (§ Feature: Landing Pages). |
| Asset detail page + in-browser preview (img/video/audio/pdf) | ❌ | New route + preview components. |
| Global search across metadata / buyer / resource type / date | ⚠️ basic multi-field | Extend to campaign/vertical/type/buyer/date filters. |
| Campaign dashboard (counts per resource type) | ❌ | New view. |
| Analytics dashboard (totals, most-accessed, most-downloaded) | ❌ | New view over existing logs. |
| Bulk upload (100+ files, progress, retry, cancel) | ⚠️ single/multi basic | Upgrade upload queue. |
| "Campaign Library" IA / renamed nav | ❌ (Files/Categories/Folders) | Reorganize nav + landing cards. |

**Good news:** the hardest infra — encrypted multi-provider storage, presigned direct
upload/download, audit logging, and per-resource access grants — is already done. Most remaining
work is **product/UX + a permission and sharing layer on top of a solid base.**

---

## 4. Target information architecture (navigation)

```
Wstorage
├── Dashboard            (analytics + recent + shared-with-me)
├── Campaign Library     (card browse: Category → Vertical → Campaign Type → Campaign → Resources)
├── Search               (global, with filters)
├── Shared with me       (grants + share links the user received)
│
└── ADMIN
    ├── Categories & Campaigns   (manage the semantic tree)
    ├── Users & Access           (roles + granular grants)  ← evolves current screen
    ├── Share Links              (create/manage/expire)
    ├── Activity Logs
    └── Storage                  (keys, providers, usage)
```
Rename **Files → Campaign Library**. Keep the current clean dashboard visual style.

---

## 5. Data model (target)

**Approach: hybrid.** Keep the flexible recursive `folders` tree (unlimited depth, humans love
it) AND attach lightweight semantic columns so the DB can answer "all Auto Insurance recordings"
without walking the tree. Do **not** hardcode any vertical/campaign in source — Super Admin
creates all of it from the admin panel.

### Semantic layer (new)
```
categories        id, name, icon, sort            (Insurance / Home Services / Web Leads)
verticals         id, category_id, name           (Auto Insurance, Roofing, ...)
campaign_types    id, name                         (Inbound, Live Transfer, Warm Transfer, Appointment, Web Leads, CPL, CPA)
campaigns         id, vertical_id, campaign_type_id, name, buyer   (e.g. "ABC Buyer — Auto LT")
```
`folders` stays as-is (recursive `parent_id`) and optionally gains `campaign_id` so a folder can
be pinned to a campaign. Assets carry denormalized `vertical_id`, `campaign_id`, `resource_type`
for fast filtered search.

### Assets (extend existing `files`)
Add: `resource_type` enum (`creative`, `ad_copy`, `landing_page`, `recording`, `script`,
`campaign_proof`, `lead_sample`, `compliance`, `zip_package`, `other`), plus landing-page fields
(`live_url`, `dev_url`, `screenshot_key`, `source_zip_key`) used only when
`resource_type = landing_page`.

### Sharing (new)
```
share_links       id, token, created_by, password_hash, expires_at, max_downloads,
                  download_count, allow_download bool, allow_upload bool, disabled bool
share_link_items  share_link_id, target_type (folder|campaign|asset), target_id
```

### Permissions (new, action-level)
```
permissions   user_id, resource_type (category|vertical|campaign|folder|asset),
              resource_id, action (view|download|upload|edit|delete|share|manage_access)
```
Existing `category_access` / `folder_access` / `file_access` are the *view* precursor; migrate
them into this unified model (or keep them as the `view` grant and layer actions on top).

**Full target table set:**
`profiles, storage_keys, categories, verticals, campaign_types, campaigns, folders, files(assets),
file_versions, asset_tags, permissions, share_links, share_link_items, favorites, collections,
activity_logs, downloads, key_requests`.

---

## 6. Roles & permission model (target)

| Role | Summary |
|---|---|
| **Super Admin** | Unrestricted. Creates categories/verticals/campaigns/folders/users, uploads, deletes, assigns roles + grants, creates/expires share links, sees analytics, manages storage. (Owner account.) |
| **Admin / Manager** | Upload, create campaigns, manage assigned campaigns/employees. Cannot manage super admins, restricted campaigns, or global security. |
| **BD Manager** | Browse assigned campaigns, search, preview, download permitted assets, copy LP links, share approved links. Cannot modify/delete originals unless granted. |
| **BD Assistant / Employee** | Restricted view: only granted categories/campaigns/folders. |
| **Client / External** | Sees only explicitly assigned resources (e.g. one buyer's inbound creatives); everything else invisible in the UI *and* denied at the DB/storage layer. |

**Access levels stack:** Category → Campaign → specific Folder (§ spec 7). Plus **temporary /
exceptional access** (grant one user just one branch) and **expiring** grants.

**Security principle (non-negotiable):** never rely on hiding items in the frontend only. Every
request re-checks "does this user have permission to this resource?" at the API + RLS layer. The
current app already does server-side checks (`canAccessFile`) and RLS — extend the same pattern
to every new resource.

---

## 7. Two sharing methods (both must exist)

- **Method A — Private account access:** create a user, assign role + scoped grants (e.g.
  Insurance → Auto Insurance → Inbound, view+download). They log in and see only that.
- **Method B — Public/private share link:** select resources → *Create Share Link* → configure
  password (optional), expiration, allow-download, max-downloads, disable-anytime → send the URL.
  Recipient needs **no account**. Backed by `share_links`; served by a public route that verifies
  token + password + expiry + download cap on every hit, then mints a short-lived signed storage URL.

---

## 8. Key feature specs (condensed)

- **Campaign Library browse:** cards, not deep trees. Category cards → vertical cards → campaign-type
  cards → resource-type tiles (🎨 Creatives, 🌐 Landing Pages, ✍️ Ad Copy, 📊 Proof, 📞 Recordings…).
- **Asset detail page:** inline preview (image/video/audio/PDF), metadata panel, actions
  [Preview] [Download] [Copy Link] [Create Share Link], version list.
- **Preview support:** images (jpg/png/webp) inline; video (mp4/mov/webm) player; audio
  (mp3/wav/m4a) player; PDF preview; CSV/XLSX basic preview or download.
- **Landing pages as first-class assets:** live URL + dev URL + screenshot + downloadable source ZIP.
- **Global search + filters:** by campaign, vertical, campaign type, asset name, tags, resource
  type, buyer, upload date.
- **Asset metadata:** name, category, vertical, campaign type, resource type, tags, uploaded-by,
  date, status — this is what makes search powerful.
- **Bulk upload:** drag-drop 100+ files, background queue, progress bar, retry failed, cancel,
  preserve shared metadata/destination.
- **Versioning:** V1/V2/V3 with "current" pointer (schema already supports it — needs UI).
- **Activity logging + Analytics:** totals (assets/users/campaigns/active links), most-accessed
  campaigns, most-downloaded assets, active users — all computable from existing logs.

---

## 9. Phased roadmap

> Rule: ship value each phase, never rebuild. Each task lists the **files/areas** it touches so a
> fresh session can jump straight in. Check items off in [`PROGRESS.md`](./PROGRESS.md).

### Phase 0 — Stabilize (fast, do first)
- Fix duplicate `CookieToSet` in `src/middleware.ts`.
- Rotate the leaked GitHub PAT; confirm `.env*` and credential files are git-ignored.
- Get a clean `npm run build`. Document local run in README if anything's missing.

### Phase 1 — Core system  *(largely DONE — verify & polish)*
Auth, super admin/employee, categories, unlimited folder hierarchy, uploads, downloads,
folder permissions. **Remaining:** confirm all flows work post-Phase-0, tidy the current
Users & Access screen.

### Phase 2 — Campaign intelligence
- Migration: `verticals`, `campaign_types`, `campaigns`; add `resource_type` + landing-page
  fields to `files`.
- Admin CRUD: **Categories & Campaigns** page to manage the semantic tree.
- Upload flow: pick Category→Vertical→Campaign Type→Campaign→Resource Type; write denormalized
  fields onto the asset.
- Rename **Files → Campaign Library**; build card-based browse IA (§4).
- Asset detail page + preview components.
- Extend search with the new filters.

### Phase 3 — Sharing
- Migration: `share_links`, `share_link_items`.
- Create/manage share links (admin UI) + public route (`/s/[token]`) with password, expiry,
  download cap, disable.
- Wire "Create Share Link" into folder + asset views.

### Phase 4 — Advanced
- Action-level permission model (`permissions` table) + BD Manager / Client roles + grant UI.
- Analytics dashboard over existing logs.
- Versioning UI (restore/compare).
- Bulk upload queue (progress/retry/cancel).
- Favorites + Recently accessed + advanced reporting.

---

## 10. Resume protocol (for when the limit resets)

When a new session starts:
1. Open [`PROGRESS.md`](./PROGRESS.md) — it names the **current phase, the last completed task,
   and the exact next task** (with file paths).
2. Skim §2 (current state) and §3 (gap analysis) here so we don't rebuild existing work.
3. Do the next unchecked task, then tick it in `PROGRESS.md` and add a dated note.
4. Keep migrations additive and numbered (`0006_…`, `0007_…`); never edit an applied migration.
5. Never hardcode a vertical/campaign in source — it must be creatable from the admin panel.
6. Re-check auth on every new API route (server-side + RLS), mirroring `canAccessFile`.

---

## 11. Open decisions (confirm with owner before building)
- Add **shadcn/ui** for faster polished components, or stay with hand-rolled Tailwind? (spec suggests shadcn)
- Roles: add **BD Manager** and **Client** now (Phase 4) or sooner?
- Storage: stay on B2/R2 (already built) — spec's "Supabase Storage first" is **already surpassed**; no action.
- Do we migrate the three existing `*_access` tables into the unified `permissions` model, or keep both?
