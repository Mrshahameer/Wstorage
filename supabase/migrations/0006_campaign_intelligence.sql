-- ============================================================
-- Wstorage — 0006: Campaign intelligence, granular permissions, share links
-- Backbone migration for the Campaign Asset & Resource Management Portal.
-- Run AFTER 0001..0005. Everything stays inside the `wstorage` schema.
--
-- Adds:
--   * Expanded roles (manager, bd_manager, client)
--   * Semantic layer: verticals, campaign_types, campaigns
--   * resource_types (with Super-Admin custom types)
--   * Asset extensions on files (resource_type, campaign links, landing-page fields, archive)
--   * Folder extensions (campaign_id, folder_type, archive)
--   * Granular permissions: user_resource_permissions (ALLOW/DENY + inheritance + expiry)
--   * Share links: share_links + share_link_resources
--   * Category presentation columns (icon, slug, sort)
--   * activity_logs.ip_address
--   * folder_descendants() recursive helper for inheritance & counts
-- ============================================================

-- ---------- 1) Expanded roles ----------
-- (alter type add value is committed per-statement in the SQL editor; safe because
--  no DML in this file uses the new values.)
do $$ begin
  alter type wstorage.app_role add value if not exists 'manager';
exception when others then null; end $$;
do $$ begin
  alter type wstorage.app_role add value if not exists 'bd_manager';
exception when others then null; end $$;
do $$ begin
  alter type wstorage.app_role add value if not exists 'client';
exception when others then null; end $$;

-- ---------- 2) Category presentation ----------
alter table wstorage.categories add column if not exists slug text;
alter table wstorage.categories add column if not exists description text;
alter table wstorage.categories add column if not exists icon text;
alter table wstorage.categories add column if not exists sort int not null default 0;
alter table wstorage.categories add column if not exists created_by uuid references wstorage.profiles(id);

-- ---------- 3) Verticals (Level 2: Auto Insurance, Roofing, ...) ----------
create table if not exists wstorage.verticals (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references wstorage.categories(id) on delete cascade,
  name text not null,
  slug text,
  description text,
  sort int not null default 0,
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  unique (category_id, name)
);
create index if not exists verticals_category_idx on wstorage.verticals(category_id);

-- ---------- 4) Campaign types (Inbound, Live Transfer, Web Leads, CPL, ...) ----------
-- Global reusable list, not tied to a vertical.
create table if not exists wstorage.campaign_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- 5) Campaigns (Level 4: specific campaign / buyer / offer) ----------
create table if not exists wstorage.campaigns (
  id uuid primary key default gen_random_uuid(),
  vertical_id uuid not null references wstorage.verticals(id) on delete cascade,
  campaign_type_id uuid references wstorage.campaign_types(id) on delete set null,
  name text not null,
  buyer text,
  description text,
  status text not null default 'active',   -- active | paused | archived
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_vertical_idx on wstorage.campaigns(vertical_id);
create index if not exists campaigns_type_idx on wstorage.campaigns(campaign_type_id);

-- ---------- 6) Resource types (Creative, Recording, Landing Page, ... + custom) ----------
create table if not exists wstorage.resource_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text unique,
  icon text,
  description text,
  is_system boolean not null default false,  -- seeded defaults vs Super-Admin custom
  sort int not null default 0,
  created_at timestamptz not null default now()
);

insert into wstorage.resource_types (name, slug, icon, is_system, sort) values
  ('Creative',        'creative',        'image',      true, 10),
  ('Video Creative',  'video-creative',  'video',      true, 20),
  ('Image Creative',  'image-creative',  'image',      true, 30),
  ('Ad Copy',         'ad-copy',         'text',       true, 40),
  ('Landing Page',    'landing-page',    'globe',      true, 50),
  ('Call Recording',  'call-recording',  'audio',      true, 60),
  ('Script',          'script',          'file-text',  true, 70),
  ('Campaign Proof',  'campaign-proof',  'check',      true, 80),
  ('Ad Screenshot',   'ad-screenshot',   'camera',     true, 90),
  ('Lead Sample',     'lead-sample',     'table',      true, 100),
  ('Compliance',      'compliance',      'shield',     true, 110),
  ('ZIP Package',     'zip-package',     'archive',    true, 120),
  ('PDF',             'pdf',             'file',       true, 130),
  ('Spreadsheet',     'spreadsheet',     'table',      true, 140),
  ('Other',           'other',           'file',       true, 999)
on conflict (name) do nothing;

-- ---------- 7) Extend folders ----------
alter table wstorage.folders add column if not exists description text;
alter table wstorage.folders add column if not exists folder_type text;
alter table wstorage.folders add column if not exists category_id uuid references wstorage.categories(id) on delete set null;
alter table wstorage.folders add column if not exists campaign_id uuid references wstorage.campaigns(id) on delete set null;
alter table wstorage.folders add column if not exists is_archived boolean not null default false;
alter table wstorage.folders add column if not exists updated_at timestamptz not null default now();

-- ---------- 8) Extend files (assets) ----------
alter table wstorage.files add column if not exists resource_type_id uuid references wstorage.resource_types(id) on delete set null;
alter table wstorage.files add column if not exists vertical_id uuid references wstorage.verticals(id) on delete set null;
alter table wstorage.files add column if not exists campaign_id uuid references wstorage.campaigns(id) on delete set null;
alter table wstorage.files add column if not exists buyer text;
alter table wstorage.files add column if not exists is_archived boolean not null default false;
-- Landing-page asset fields (used only when the resource type is a landing page)
alter table wstorage.files add column if not exists live_url text;
alter table wstorage.files add column if not exists dev_url text;
alter table wstorage.files add column if not exists screenshot_key text;
alter table wstorage.files add column if not exists source_zip_key text;

create index if not exists files_resource_type_idx on wstorage.files(resource_type_id);
create index if not exists files_vertical_idx on wstorage.files(vertical_id);
create index if not exists files_campaign_idx on wstorage.files(campaign_id);

-- ---------- 9) Granular resource permissions ----------
-- Action-level ALLOW/DENY grants on any resource, with inheritance to children
-- and optional expiry (for temporary buyer access). DENY always beats ALLOW.
create table if not exists wstorage.user_resource_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references wstorage.profiles(id) on delete cascade,
  resource_type text not null check (resource_type in ('category','vertical','campaign','folder','file')),
  resource_id uuid not null,
  permission text not null check (permission in ('view','download','upload','edit','delete','share','manage_access')),
  access_mode text not null default 'allow' check (access_mode in ('allow','deny')),
  inherit_to_children boolean not null default true,
  expires_at timestamptz,
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now(),
  unique (user_id, resource_type, resource_id, permission)
);
create index if not exists urp_user_idx on wstorage.user_resource_permissions(user_id);
create index if not exists urp_resource_idx on wstorage.user_resource_permissions(resource_type, resource_id);

-- ---------- 10) Share links (public/private, no account needed) ----------
create table if not exists wstorage.share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  name text,
  password_hash text,                    -- null = no password
  allow_preview boolean not null default true,
  allow_download boolean not null default true,
  expires_at timestamptz,
  max_downloads int,                     -- null = unlimited
  current_downloads int not null default 0,
  max_views int,
  current_views int not null default 0,
  status text not null default 'active', -- active | disabled
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists share_links_token_idx on wstorage.share_links(token);

create table if not exists wstorage.share_link_resources (
  id uuid primary key default gen_random_uuid(),
  share_link_id uuid not null references wstorage.share_links(id) on delete cascade,
  resource_type text not null check (resource_type in ('folder','campaign','file')),
  resource_id uuid not null
);
create index if not exists slr_link_idx on wstorage.share_link_resources(share_link_id);

-- ---------- 11) activity_logs: capture IP ----------
alter table wstorage.activity_logs add column if not exists ip_address text;

-- ---------- 12) Recursive folder descendants helper ----------
-- Returns the folder itself plus every nested child. Used for permission
-- inheritance and campaign/folder asset counts.
create or replace function wstorage.folder_descendants(root uuid)
returns table(id uuid) language sql stable security definer set search_path = wstorage as $$
  with recursive tree as (
    select f.id from wstorage.folders f where f.id = root
    union all
    select c.id from wstorage.folders c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

-- ---------- 13) RLS + grants for new tables ----------
alter table wstorage.verticals                enable row level security;
alter table wstorage.campaign_types           enable row level security;
alter table wstorage.campaigns                enable row level security;
alter table wstorage.resource_types           enable row level security;
alter table wstorage.user_resource_permissions enable row level security;
alter table wstorage.share_links              enable row level security;
alter table wstorage.share_link_resources     enable row level security;

-- Authenticated users may read the taxonomy (row-level asset gating happens in the app layer).
drop policy if exists "auth read verticals" on wstorage.verticals;
create policy "auth read verticals" on wstorage.verticals for select using (auth.uid() is not null);
drop policy if exists "auth read campaign_types" on wstorage.campaign_types;
create policy "auth read campaign_types" on wstorage.campaign_types for select using (auth.uid() is not null);
drop policy if exists "auth read campaigns" on wstorage.campaigns;
create policy "auth read campaigns" on wstorage.campaigns for select using (auth.uid() is not null);
drop policy if exists "auth read resource_types" on wstorage.resource_types;
create policy "auth read resource_types" on wstorage.resource_types for select using (auth.uid() is not null);

-- Users see their own permission rows; admins see all.
drop policy if exists "own perms read" on wstorage.user_resource_permissions;
create policy "own perms read" on wstorage.user_resource_permissions
  for select using (user_id = auth.uid() or wstorage.is_admin());

-- Share links: admins read; creation/serving happen via the service role.
drop policy if exists "admin read share_links" on wstorage.share_links;
create policy "admin read share_links" on wstorage.share_links for select using (wstorage.is_admin());
drop policy if exists "admin read share_link_resources" on wstorage.share_link_resources;
create policy "admin read share_link_resources" on wstorage.share_link_resources for select using (wstorage.is_admin());

grant all on wstorage.verticals to service_role;
grant all on wstorage.campaign_types to service_role;
grant all on wstorage.campaigns to service_role;
grant all on wstorage.resource_types to service_role;
grant all on wstorage.user_resource_permissions to service_role;
grant all on wstorage.share_links to service_role;
grant all on wstorage.share_link_resources to service_role;

grant select on wstorage.verticals to authenticated;
grant select on wstorage.campaign_types to authenticated;
grant select on wstorage.campaigns to authenticated;
grant select on wstorage.resource_types to authenticated;
grant select on wstorage.user_resource_permissions to authenticated;

-- ---------- 14) Seed campaign types + starter taxonomy ----------
insert into wstorage.campaign_types (name, sort) values
  ('Inbound', 10), ('Warm Transfer', 20), ('Live Transfer', 30),
  ('Appointment', 40), ('Web Leads', 50), ('CPL', 60), ('CPA', 70)
on conflict (name) do nothing;

insert into wstorage.categories (name, icon, sort) values
  ('Insurance', 'shield', 10), ('Home Services', 'home', 20), ('Web Leads', 'globe', 30)
on conflict (name) do nothing;
