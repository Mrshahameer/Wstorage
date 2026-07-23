-- ============================================================
-- Wstorage — Core schema  (v1.1, schema-isolated)
--
-- SAFE TO RUN alongside your other product. Everything lives in a
-- dedicated `wstorage` schema and creates NOTHING in `public`, so it
-- cannot touch your sources / routes / user_profiles / settings tables.
-- The only object on a shared table is one uniquely-named trigger on
-- auth.users (wstorage_on_auth_user_created) — it never affects yours.
-- ============================================================

create schema if not exists wstorage;
create extension if not exists pgcrypto;

-- Roles that can reach the schema. service_role is what the app uses.
grant usage on schema wstorage to anon, authenticated, service_role;

-- ---------- Enums (namespaced inside wstorage) ----------
do $$ begin
  create type wstorage.role as enum ('super_admin', 'admin', 'employee');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wstorage.storage_provider as enum ('backblaze');
exception when duplicate_object then null; end $$;

do $$ begin
  create type wstorage.storage_key_status as enum ('active', 'revoked');
exception when duplicate_object then null; end $$;

-- ---------- Profiles (mirrors auth.users) ----------
create table if not exists wstorage.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role wstorage.role not null default 'employee',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Storage keys (dashboard-managed B2 credentials) ----------
create table if not exists wstorage.storage_keys (
  id uuid primary key default gen_random_uuid(),
  provider wstorage.storage_provider not null default 'backblaze',
  label text not null,
  key_id text not null,
  secret_encrypted text not null,       -- AES-256-GCM ciphertext (app layer)
  bucket_id text not null,
  bucket_name text not null,
  region text not null,
  is_active boolean not null default false,
  status wstorage.storage_key_status not null default 'active',
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists storage_keys_one_active_per_provider
  on wstorage.storage_keys (provider) where is_active;

-- ---------- Folders ----------
create table if not exists wstorage.folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references wstorage.folders(id) on delete cascade,
  path text not null,
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists folders_parent_idx on wstorage.folders(parent_id);

-- ---------- Categories ----------
create table if not exists wstorage.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- Files ----------
create table if not exists wstorage.files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  folder_id uuid references wstorage.folders(id) on delete set null,
  category_id uuid references wstorage.categories(id) on delete set null,
  tags text[] not null default '{}',
  extension text,
  content_type text,
  size_bytes bigint not null default 0,
  sha256 text,
  storage_key_id uuid references wstorage.storage_keys(id),
  object_key text not null,
  current_version int not null default 1,
  download_count int not null default 0,
  status text not null default 'pending',
  uploaded_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists files_folder_idx on wstorage.files(folder_id);
create index if not exists files_category_idx on wstorage.files(category_id);
create index if not exists files_sha_idx on wstorage.files(sha256);
create index if not exists files_name_fts on wstorage.files using gin (to_tsvector('simple', name));

-- ---------- File versions ----------
create table if not exists wstorage.file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references wstorage.files(id) on delete cascade,
  version int not null,
  object_key text not null,
  storage_key_id uuid references wstorage.storage_keys(id),
  size_bytes bigint not null default 0,
  sha256 text,
  notes text,
  uploaded_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  unique (file_id, version)
);

-- ---------- Favorites ----------
create table if not exists wstorage.favorites (
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  file_id uuid not null references wstorage.files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

-- ---------- Collections ----------
create table if not exists wstorage.collections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists wstorage.collection_files (
  collection_id uuid not null references wstorage.collections(id) on delete cascade,
  file_id uuid not null references wstorage.files(id) on delete cascade,
  primary key (collection_id, file_id)
);

-- ---------- Activity log / downloads ----------
create table if not exists wstorage.activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references wstorage.profiles(id),
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activity_created_idx on wstorage.activity_logs(created_at desc);

create table if not exists wstorage.downloads (
  id bigint generated always as identity primary key,
  file_id uuid references wstorage.files(id) on delete set null,
  user_id uuid references wstorage.profiles(id),
  created_at timestamptz not null default now()
);

-- ---------- Atomic download counter ----------
create or replace function wstorage.increment_download_count(p_file_id uuid)
returns void language sql security definer set search_path = wstorage as $$
  update wstorage.files set download_count = download_count + 1 where id = p_file_id;
$$;

-- ---------- Auto-create a profile when an auth user is invited/created ----------
create or replace function wstorage.handle_new_user()
returns trigger language plpgsql security definer set search_path = wstorage as $$
begin
  insert into wstorage.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::wstorage.role, 'employee')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Uniquely named so it NEVER collides with any other product's auth trigger.
drop trigger if exists wstorage_on_auth_user_created on auth.users;
create trigger wstorage_on_auth_user_created
  after insert on auth.users
  for each row execute function wstorage.handle_new_user();

-- ---------- Grants (app uses service_role; authenticated kept for future direct reads) ----------
grant all on all tables in schema wstorage to service_role;
grant select on all tables in schema wstorage to authenticated;
grant usage, select on all sequences in schema wstorage to service_role;
grant execute on all functions in schema wstorage to service_role, authenticated;
alter default privileges in schema wstorage grant all on tables to service_role;
alter default privileges in schema wstorage grant select on tables to authenticated;
