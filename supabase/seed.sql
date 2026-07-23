-- ============================================================
-- Wisko DAM — Seed
-- Run AFTER creating your first user in Supabase Auth (invite yourself).
-- Then promote that user to super_admin.
-- ============================================================

-- Example: promote a user to super_admin by email.
-- update public.profiles set role = 'super_admin' where email = 'you@company.com';

-- Starter categories
insert into public.categories (name) values
  ('Programming'), ('Clients'), ('Videos'), ('Design'), ('Documents')
on conflict (name) do nothing;

-- Root folders
insert into public.folders (name, path) values
  ('Programming', '/Programming'),
  ('Clients', '/Clients'),
  ('Videos', '/Videos')
on conflict do nothing;
