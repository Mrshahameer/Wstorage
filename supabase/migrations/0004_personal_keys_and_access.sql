-- ============================================================
-- Wstorage — 0004: Category/File access, Profile permissions, Personal Key Requests
-- ============================================================

-- 1) Category access table
create table if not exists wstorage.category_access (
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  category_id uuid not null references wstorage.categories(id) on delete cascade,
  granted_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);
create index if not exists category_access_user_idx on wstorage.category_access(user_id);

-- 2) File-level access table
create table if not exists wstorage.file_access (
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  file_id uuid not null references wstorage.files(id) on delete cascade,
  granted_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);
create index if not exists file_access_user_idx on wstorage.file_access(user_id);

-- 3) Expand profiles with explicit permission flags
alter table wstorage.profiles add column if not exists can_upload boolean not null default true;
alter table wstorage.profiles add column if not exists can_edit boolean not null default true;
alter table wstorage.profiles add column if not exists can_delete boolean not null default false;
alter table wstorage.profiles add column if not exists can_download boolean not null default true;

-- 4) Add owner_id and is_personal to storage_keys
alter table wstorage.storage_keys add column if not exists owner_id uuid references wstorage.profiles(id);
alter table wstorage.storage_keys add column if not exists is_personal boolean not null default false;

-- 5) Personal storage key request workflow table
create table if not exists wstorage.key_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  status text not null default 'pending', -- pending | approved | rejected
  notes text,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references wstorage.profiles(id),
  reviewed_at timestamptz
);
create index if not exists key_requests_user_idx on wstorage.key_requests(user_id);

-- 6) Grants
grant all on wstorage.category_access to service_role;
grant select on wstorage.category_access to authenticated;

grant all on wstorage.file_access to service_role;
grant select on wstorage.file_access to authenticated;

grant all on wstorage.key_requests to service_role;
grant select on wstorage.key_requests to authenticated;

-- 7) Seed categories and folders
insert into wstorage.categories (name) values
  ('Programming'), ('Clients'), ('Videos'), ('Design'), ('Documents'), ('Marketing'), ('Finance')
on conflict (name) do nothing;

insert into wstorage.folders (name, path) values
  ('Company Shared', '/Company Shared'),
  ('Clients', '/Clients'),
  ('Marketing Assets', '/Marketing Assets'),
  ('Engineering', '/Engineering'),
  ('Internal Docs', '/Internal Docs')
on conflict do nothing;
