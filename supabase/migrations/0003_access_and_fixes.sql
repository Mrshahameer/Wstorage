-- ============================================================
-- Wstorage — 0003: Bucket ID optional + per-user folder access
-- Run this in the Supabase SQL editor AFTER 0001 and 0002.
-- ============================================================

-- 1) Bucket ID isn't needed by the S3-compatible provider (it uses bucket NAME
--    + region). Stop requiring it.
alter table wstorage.storage_keys alter column bucket_id drop not null;

-- 2) Per-user folder access. An employee sees a file only if its folder is
--    granted to them (or the file has no folder = shared pool). Admins see all.
create table if not exists wstorage.folder_access (
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  folder_id uuid not null references wstorage.folders(id) on delete cascade,
  granted_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);
create index if not exists folder_access_user_idx on wstorage.folder_access(user_id);

alter table wstorage.folder_access enable row level security;
drop policy if exists "own access read" on wstorage.folder_access;
create policy "own access read" on wstorage.folder_access
  for select using (user_id = auth.uid() or wstorage.is_admin());

-- 3) Grants (matches the rest of the schema).
grant all on wstorage.folder_access to service_role;
grant select on wstorage.folder_access to authenticated;
