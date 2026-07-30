-- ============================================================
-- Wstorage — 0005: Cloudflare R2 storage provider support
-- ============================================================

-- 1) Add 'r2' to the storage_provider enum.
alter type wstorage.storage_provider add value if not exists 'r2';

-- 2) R2 needs a Cloudflare Account ID to build its S3-compatible endpoint
--    (https://<ACCOUNT_ID>.r2.cloudflarestorage.com). Backblaze rows leave
--    this null. R2 rows leave bucket_id null (B2-only concept) and store
--    "auto" in the existing region column, since R2's S3 API always uses
--    region "auto".
alter table wstorage.storage_keys add column if not exists account_id text;

-- 3) Fix: previously "one active key per provider" was enforced, which meant
--    a Backblaze key AND an R2 key could both be active at the same time.
--    getActiveProvider() picks a single row for new uploads with no provider
--    filter, so that was ambiguous/non-deterministic. Enforce ONE active key
--    globally instead, across all providers.
drop index if exists wstorage.storage_keys_one_active_per_provider;
create unique index if not exists storage_keys_one_active_global
  on wstorage.storage_keys (is_active) where is_active;
