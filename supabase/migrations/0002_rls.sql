-- ============================================================
-- Wstorage — Row Level Security (wstorage schema only)
-- Writes to files/storage happen via server routes using the service role,
-- which bypasses RLS. These policies gate any direct authenticated reads.
-- Nothing here references or affects public.* (the other product).
-- ============================================================

-- Helper: current user's Wstorage role.
-- Named current_app_role (NOT current_role) to avoid shadowing the Postgres built-in.
create or replace function wstorage.current_app_role()
returns wstorage.app_role language sql stable security definer set search_path = wstorage as $$
  select role from wstorage.profiles where id = auth.uid();
$$;

create or replace function wstorage.is_admin()
returns boolean language sql stable security definer set search_path = wstorage as $$
  select coalesce(wstorage.current_app_role() in ('admin','super_admin'), false);
$$;

-- Enable RLS
alter table wstorage.profiles         enable row level security;
alter table wstorage.storage_keys     enable row level security;
alter table wstorage.folders          enable row level security;
alter table wstorage.categories       enable row level security;
alter table wstorage.files            enable row level security;
alter table wstorage.file_versions    enable row level security;
alter table wstorage.favorites        enable row level security;
alter table wstorage.collections      enable row level security;
alter table wstorage.collection_files enable row level security;
alter table wstorage.activity_logs    enable row level security;
alter table wstorage.downloads        enable row level security;

-- profiles
drop policy if exists "own profile read" on wstorage.profiles;
create policy "own profile read" on wstorage.profiles
  for select using (id = auth.uid() or wstorage.is_admin());
drop policy if exists "admin manage profiles" on wstorage.profiles;
create policy "admin manage profiles" on wstorage.profiles
  for all using (wstorage.is_admin()) with check (wstorage.is_admin());

-- storage_keys: admins read metadata only; secret never leaves the server.
drop policy if exists "admin read storage keys" on wstorage.storage_keys;
create policy "admin read storage keys" on wstorage.storage_keys
  for select using (wstorage.is_admin());

-- Secret-free view, respects caller RLS.
create or replace view wstorage.storage_keys_safe
  with (security_invoker = true) as
  select id, provider, label, key_id, bucket_name, region,
         is_active, status, created_at, revoked_at
  from wstorage.storage_keys;
grant select on wstorage.storage_keys_safe to authenticated;

-- Readable by any authenticated user; writes via server (service role).
drop policy if exists "auth read files" on wstorage.files;
create policy "auth read files" on wstorage.files
  for select using (auth.uid() is not null);
drop policy if exists "auth read folders" on wstorage.folders;
create policy "auth read folders" on wstorage.folders
  for select using (auth.uid() is not null);
drop policy if exists "auth read categories" on wstorage.categories;
create policy "auth read categories" on wstorage.categories
  for select using (auth.uid() is not null);
drop policy if exists "auth read versions" on wstorage.file_versions;
create policy "auth read versions" on wstorage.file_versions
  for select using (auth.uid() is not null);
drop policy if exists "auth read collections" on wstorage.collections;
create policy "auth read collections" on wstorage.collections
  for select using (auth.uid() is not null);
drop policy if exists "auth read collection_files" on wstorage.collection_files;
create policy "auth read collection_files" on wstorage.collection_files
  for select using (auth.uid() is not null);

-- favorites: user owns their own
drop policy if exists "own favorites" on wstorage.favorites;
create policy "own favorites" on wstorage.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- activity/downloads: admins read
drop policy if exists "admin read activity" on wstorage.activity_logs;
create policy "admin read activity" on wstorage.activity_logs
  for select using (wstorage.is_admin());
drop policy if exists "admin read downloads" on wstorage.downloads;
create policy "admin read downloads" on wstorage.downloads
  for select using (wstorage.is_admin());
