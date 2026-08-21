// Deletes every user EXCEPT the owner super-admin. Run: node --env-file=.env.local scripts/prune-users.mjs
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const w = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "wstorage" }, auth: { persistSession: false } });
const KEEP = "shahmeerrehman333@gmail.com";

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
let deleted = 0, kept = 0;
for (const u of list?.users ?? []) {
  if ((u.email || "").toLowerCase() === KEEP.toLowerCase()) {
    await w.from("profiles").update({ role: "super_admin", is_active: true }).eq("id", u.id);
    kept++; continue;
  }
  await admin.auth.admin.deleteUser(u.id); // cascades profile + grants
  deleted++;
}
// belt-and-suspenders: remove any orphan profiles not matching KEEP
const { data: profs } = await w.from("profiles").select("id,email");
for (const p of profs ?? []) if ((p.email || "").toLowerCase() !== KEEP.toLowerCase()) await w.from("profiles").delete().eq("id", p.id);

const { data: remaining } = await w.from("profiles").select("email,role");
console.log(`deleted ${deleted} users, kept ${kept}`);
console.log("remaining profiles:", JSON.stringify(remaining));
