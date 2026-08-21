-- ============================================================
-- Wstorage — 0007: folder sort order for resource folders
-- ============================================================
alter table wstorage.folders add column if not exists sort int not null default 0;
create index if not exists folders_campaign_idx on wstorage.folders(campaign_id);
