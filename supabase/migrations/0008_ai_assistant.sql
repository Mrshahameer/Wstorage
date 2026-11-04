-- ============================================================
-- Wstorage — 0008: AI Search Assistant
-- Stores admin-managed AI provider keys (Gemini / Groq) and settings.
-- Keys are AES-256-GCM encrypted by the app before they land here, the same
-- way storage-key secrets are. Only the service role can read this table, so
-- keys never reach the browser. Run AFTER 0001..0007 in the Supabase SQL editor.
-- ============================================================

-- Unlimited keys per provider. The app rotates across active keys and skips any
-- that are cooling down after a rate-limit, then fails over to the next provider.
create table if not exists wstorage.ai_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'groq')),
  label text not null,
  api_key_encrypted text not null,
  status text not null default 'active' check (status in ('active', 'revoked')),
  cooldown_until timestamptz,                 -- set when a key is rate-limited
  last_used_at timestamptz,                   -- least-recently-used rotation
  use_count bigint not null default 0,
  created_by uuid references wstorage.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists ai_keys_pick_idx on wstorage.ai_keys (provider, status, last_used_at);

-- One settings row. provider_order decides which provider is tried first.
-- The model names are editable here so a provider deprecating a model is a
-- settings change, not a code change.
create table if not exists wstorage.ai_settings (
  id int primary key default 1,
  provider_order text[] not null default array['gemini', 'groq'],
  enabled boolean not null default true,
  gemini_model text not null default 'gemini-flash-latest',
  groq_model text not null default 'openai/gpt-oss-120b',
  updated_at timestamptz not null default now(),
  constraint ai_settings_singleton check (id = 1)
);
alter table wstorage.ai_settings add column if not exists gemini_model text not null default 'gemini-flash-latest';
alter table wstorage.ai_settings add column if not exists groq_model text not null default 'openai/gpt-oss-120b';
insert into wstorage.ai_settings (id) values (1) on conflict (id) do nothing;

-- Service-role only. No authenticated grants, so keys stay server-side.
alter table wstorage.ai_keys enable row level security;
alter table wstorage.ai_settings enable row level security;
grant all on wstorage.ai_keys to service_role;
grant all on wstorage.ai_settings to service_role;
