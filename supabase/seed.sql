-- ============================================================
-- Wstorage — Seed (run AFTER inviting your first user in Supabase Auth)
-- ============================================================

-- Promote yourself to super_admin (edit the email):
-- update wstorage.profiles set role = 'super_admin' where email = 'you@company.com';

insert into wstorage.categories (name) values
  ('Programming'), ('Clients'), ('Videos'), ('Design'), ('Documents')
on conflict (name) do nothing;

insert into wstorage.folders (name, path) values
  ('Programming', '/Programming'),
  ('Clients', '/Clients'),
  ('Videos', '/Videos')
on conflict do nothing;
