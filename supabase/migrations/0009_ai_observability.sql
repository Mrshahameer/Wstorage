-- ============================================================
-- Wstorage — 0009: AI assistant observability and feedback
-- ai_calls: one row per model request (which model and key, ok or why it
-- failed, how long it took). Powers the usage panel in AI Control and tells
-- you when a quota is used up.
-- ai_feedback: thumbs up/down on assistant replies. Thumbs-down replies show
-- in AI Control so bad answers become test cases.
-- Run AFTER 0001..0008 in the Supabase SQL editor. Safe to run twice.
-- ============================================================

create table if not exists wstorage.ai_calls (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references wstorage.profiles(id) on delete set null,
  provider text not null,
  model text not null,
  key_id uuid references wstorage.ai_keys(id) on delete set null,
  status text not null,          -- ok | quota | rate_limited | overloaded | timeout | auth | bad_output | error
  http_status int,
  latency_ms int,
  round int,
  error text
);
create index if not exists ai_calls_created_idx on wstorage.ai_calls (created_at desc);

create table if not exists wstorage.ai_feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references wstorage.profiles(id) on delete set null,
  rating smallint not null check (rating in (-1, 1)),
  query text not null,
  reply text not null,
  meta jsonb
);
create index if not exists ai_feedback_created_idx on wstorage.ai_feedback (created_at desc);

-- Service-role only, like the keys table. Nothing here reaches the browser directly.
alter table wstorage.ai_calls enable row level security;
alter table wstorage.ai_feedback enable row level security;
grant all on wstorage.ai_calls to service_role;
grant all on wstorage.ai_feedback to service_role;
