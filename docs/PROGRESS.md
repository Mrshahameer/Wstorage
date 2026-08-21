# Wstorage — Progress & Resume Tracker

> **Read this FIRST when starting or resuming a session.** It tells you exactly where we stopped
> and what to do next. Full detail lives in [`PROJECT_PLAN.md`](./PROJECT_PLAN.md).
> After finishing a task: tick its box, and add a dated line under **Session log**.

- **Current phase:** Phase 2 in progress; Phase 3 (share links) backend + UI DONE
- **Next task:** Phase 2 — wire the campaign taxonomy (Vertical / Campaign / Resource Type) selectors
  into the **upload flow** (`src/components/upload-panel.tsx` + `api/upload/presign`, write the
  denormalized `vertical_id`/`campaign_id`/`resource_type_id`), then build the **asset detail + preview** page.
- **Last updated:** 2026-08-21

---

## Phase 0 — Stabilize
- [x] Fix duplicate `type CookieToSet` in `src/middleware.ts` (also added `/share` + `/api/share` to public paths)
- [ ] Rotate the leaked GitHub PAT; confirm `.env*` + credential files are git-ignored  ← **owner action**
- [x] Clean `npm install` + `npm run build` with no errors
- [ ] Confirm README setup steps still accurate

## Phase 1 — Core system (built — verify)
- [x] Auth + RBAC, storage abstraction (B2 + R2), encrypted keys, presigned upload/download
- [x] Recursive folders + categories, per-category/folder/file access grants, versions, logs
- [ ] End-to-end smoke test against a live Supabase after applying migration 0006
- [ ] Polish current Users & Access screen

## Phase 2 — Campaign intelligence
- [x] Migration `0006`: `verticals`, `campaign_types`, `campaigns` tables
- [x] Migration `0006`: `resource_types` table + landing-page fields on `files` + campaign links + IP on logs
- [x] Admin page: **Campaign management** (`/settings/campaigns`) — manage the semantic tree
- [x] Taxonomy APIs: `/api/verticals`, `/api/campaign-types`, `/api/campaigns`, `/api/resource-types`, categories POST
- [x] Rename **Files → Campaign Library** in nav + group admin links under "Administration"
- [ ] Upload flow: Category→Vertical→Campaign Type→Campaign→Resource Type selectors (write denormalized fields)
- [ ] Card-based Campaign Library browse IA (`/files` still the old flat browser)
- [ ] Asset detail page + preview (image / video / audio / pdf)
- [ ] Extend search: vertical / campaign type / resource type / buyer / date filters

## Phase 3 — Sharing  ✅ core done
- [x] Migration: `share_links` + `share_link_resources`
- [x] Share engine `src/lib/share.ts` (token, scrypt password, expiry/limit checks, file expansion, signed download)
- [x] Admin APIs: `/api/share-links` (create/list), `/api/share-links/[id]` (disable/enable/delete)
- [x] Public APIs (no auth): `/api/share/[token]` (list + password gate), `/api/share/[token]/download` (signed URL)
- [x] Public page `/share/[token]` (password prompt + file list + download)
- [x] Admin UI: `/settings/share-links` (create by folder/campaign, password/expiry/cap, copy/disable/delete)
- [ ] "Create Share Link" shortcut inside folder + asset views (currently only the admin page)

## Phase 4 — Advanced (some pulled forward)
- [x] Granular `user_resource_permissions` table (7 actions, ALLOW/DENY, inherit, expiry)
- [x] Permission resolver `src/lib/permissions.ts` (chain walk, DENY-beats-ALLOW, legacy view-grant fallback)
- [x] Expanded roles enum: + `manager`, `bd_manager`, `client`
- [ ] Grant UI to assign granular permissions per user (Users & access still folder-grants only)
- [ ] Wire resolver into download/upload routes (still using legacy `canAccessFile`)
- [ ] Analytics dashboard (totals, most-accessed, most-downloaded, active users)
- [ ] Versioning UI (restore / compare)
- [ ] Bulk upload queue (progress / retry / cancel)
- [ ] Favorites + Recently accessed + advanced reporting

---

## How to apply migration 0006 (owner step)
In the Supabase SQL editor, run `supabase/migrations/0006_campaign_intelligence.sql` once.
It is additive and idempotent (safe to re-run). No existing data is dropped.

---

## Session log
_Newest first. One or two lines per working session: what got done, what's next._

- **2026-08-21 (session 2)** — Executed the blueprint. Phase 0 build fix (middleware). Wrote
  migration `0006` (semantic layer + resource types + granular permissions + share links).
  Built taxonomy APIs + Campaign management UI. Built the **entire share-link system** end-to-end
  (engine, admin APIs, public no-auth APIs, public page, admin management UI). Added permission
  resolver + expanded roles. Renamed Files→Campaign Library in nav. `npm run build` green.
  **Next:** taxonomy selectors in the upload flow, then asset detail + preview.
- **2026-08-21 (session 1)** — Cloned repo, read full codebase, wrote `PROJECT_PLAN.md` + this tracker.
  Mapped existing app to the spec.
