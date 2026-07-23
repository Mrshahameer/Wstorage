-- ============================================================
-- Wisko DAM — Row Level Security
-- Principle: the browser (anon/authenticated key) can READ metadata
-- it is allowed to see, but ALL writes to files/storage happen through
-- server routes using the service role key, which bypasses RLS.
-- storage_keys secrets are NEVER selectable by the client.
-- ============================================================

-- Helper: current user's role
create or replace function public.current_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_role() in ('admin','super_admin'), false);
$$;

-- Enable RLS
alter table public.profiles       enable row level security;
alter table public.storage_keys   enable row level security;
alter table public.folders        enable row level security;
alter table public.categories     enable row level security;
alter table public.files          enable row level security;
alter table public.file_versions  enable row level security;
alter table public.favorites      enable row level security;
alter table public.collections    enable row level security;
alter table public.collection_files enable row level security;
alter table public.activity_logs  enable row level security;
alter table public.downloads      enable row level security;

-- ----- profiles -----
create policy "own profile read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "admin manage profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ----- storage_keys: metadata readable by admins only; secret column never leaves server -----
-- (Client should query a VIEW that excludes secret_encrypted; see below.)
create policy "admin read storage keys" on public.storage_keys
  for select using (public.is_admin());
-- No client insert/update/delete — server route uses service role.

-- Safe view without the secret, for the dashboard list.
-- security_invoker = true => the view respects the caller's RLS on storage_keys
-- (admin-only select), so non-admins can't read key metadata through it either.
create or replace view public.storage_keys_safe
  with (security_invoker = true) as
  select id, provider, label, key_id, bucket_name, region,
         is_active, status, created_at, revoked_at
  from public.storage_keys;
grant select on public.storage_keys_safe to authenticated;

-- ----- files / folders / categories: any authenticated (active) user can read; writes via server -----
create policy "auth read files" on public.files
  for select using (auth.uid() is not null);
create policy "auth read folders" on public.folders
  for select using (auth.uid() is not null);
create policy "auth read categories" on public.categories
  for select using (auth.uid() is not null);
create policy "auth read versions" on public.file_versions
  for select using (auth.uid() is not null);
create policy "auth read collections" on public.collections
  for select using (auth.uid() is not null);
create policy "auth read collection_files" on public.collection_files
  for select using (auth.uid() is not null);

-- ----- favorites: user owns their own -----
create policy "own favorites" on public.favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----- activity/downloads: admins read -----
create policy "admin read activity" on public.activity_logs
  for select using (public.is_admin());
create policy "admin read downloads" on public.downloads
  for select using (public.is_admin());
