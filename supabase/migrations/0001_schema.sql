-- ============================================================
-- Wisko DAM — Core schema
-- Run in Supabase SQL editor (or via supabase db push).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
do $$ begin
  create type app_role as enum ('super_admin', 'admin', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type storage_provider as enum ('backblaze');
exception when duplicate_object then null; end $$;

do $$ begin
  create type storage_key_status as enum ('active', 'revoked');
exception when duplicate_object then null; end $$;

-- ---------- Profiles (mirrors auth.users) ----------
-- Supabase manages auth.users. We keep app-level data here.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role app_role not null default 'employee',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Storage keys (the dashboard-managed B2 credentials) ----------
-- Secrets are AES-256-GCM encrypted at the app layer before insert.
create table if not exists public.storage_keys (
  id uuid primary key default gen_random_uuid(),
  provider storage_provider not null default 'backblaze',
  label text not null,
  key_id text not null,                 -- B2 applicationKeyId (identifier, not secret)
  secret_encrypted text not null,       -- AES-GCM ciphertext of applicationKey
  bucket_id text not null,
  bucket_name text not null,
  region text not null,                 -- e.g. us-west-004
  is_active boolean not null default false, -- the key used for NEW uploads
  status storage_key_status not null default 'active',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
-- Only one active key per provider at a time.
create unique index if not exists storage_keys_one_active_per_provider
  on public.storage_keys (provider) where is_active;

-- ---------- Folders ----------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references public.folders(id) on delete cascade,
  path text not null,                   -- materialized path, e.g. /Clients/ABC
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists folders_parent_idx on public.folders(parent_id);

-- ---------- Categories ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- Files ----------
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  folder_id uuid references public.folders(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  tags text[] not null default '{}',
  extension text,
  content_type text,
  size_bytes bigint not null default 0,
  sha256 text,                          -- for duplicate detection
  storage_key_id uuid references public.storage_keys(id), -- which B2 key holds it
  object_key text not null,             -- key/path inside the bucket
  current_version int not null default 1,
  download_count int not null default 0,
  status text not null default 'pending', -- pending | ready
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists files_folder_idx on public.files(folder_id);
create index if not exists files_category_idx on public.files(category_id);
create index if not exists files_sha_idx on public.files(sha256);
create index if not exists files_name_trgm on public.files using gin (to_tsvector('simple', name));

-- ---------- File versions ----------
create table if not exists public.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files(id) on delete cascade,
  version int not null,
  object_key text not null,
  storage_key_id uuid references public.storage_keys(id),
  size_bytes bigint not null default 0,
  sha256 text,
  notes text,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (file_id, version)
);

-- ---------- Favorites ----------
create table if not exists public.favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

-- ---------- Collections ----------
create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.collection_files (
  collection_id uuid not null references public.collections(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  primary key (collection_id, file_id)
);

-- ---------- Activity log / downloads ----------
create table if not exists public.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,                 -- upload | download | delete | update | login | key_added | key_revoked ...
  target_type text,                     -- file | folder | user | storage_key
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on public.activity_logs(created_at desc);

create table if not exists public.downloads (
  id bigint generated always as identity primary key,
  file_id uuid references public.files(id) on delete set null,
  user_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Auto-create a profile when a user is invited/created ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'employee')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Atomic download counter ----------
create or replace function public.increment_download_count(p_file_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.files set download_count = download_count + 1 where id = p_file_id;
$$;
