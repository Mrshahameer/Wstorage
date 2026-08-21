// Tests nested-folder API: top-level listing, subfolder create, parent listing,
// top-level excludes nested. Run: node --env-file=.env.local scripts/test-folders.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
const BASE = "http://localhost:3222";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"} ${l}${e ? " — " + e : ""}`); c ? pass++ : fail++; };

const email = `zz_fold_${Date.now()}@example.com`, password = "Test-" + Math.random().toString(36).slice(2) + "!9";
const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (cu.error) { console.log("create user failed:", JSON.stringify(cu.error)); process.exit(1); }
await w.from("profiles").update({ role: "super_admin" }).eq("id", cu.data.user.id);
const jar = {};
const ssr = createServerClient(url, anon, { cookies: { getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => { jar[name] = value; }) } });
await ssr.auth.signInWithPassword({ email, password });
const cookie = Object.entries(jar).map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
const call = async (path, method = "GET", body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

// Use an existing seeded campaign + its Creatives folder.
const camp = await w.from("campaigns").select("id").eq("name", "Auto Insurance Pure Inbound").single();
const campId = camp.data.id;
let r = await call(`/api/folders?campaignId=${campId}`);
const topCount = (r.j.folders ?? []).length;
ok("top-level folders for campaign (parent null)", r.status === 200 && topCount >= 7 && r.j.folders.every((f) => f.parent_id === null), `count ${topCount}`);
const creatives = r.j.folders.find((f) => f.name === "Creatives");

r = await call("/api/folders", "POST", { name: "ZZ Batch 2026", parentId: creatives.id, campaignId: campId });
ok("create subfolder under Creatives", r.status === 200 && r.j.folder?.id, `${r.status} ${r.j?.error || ""}`);
const subId = r.j.folder?.id;
ok("subfolder inherits campaign_id", r.j.folder?.campaign_id === campId);
ok("subfolder has correct parent", r.j.folder?.parent_id === creatives.id);

r = await call(`/api/folders?parentId=${creatives.id}`);
ok("parent listing returns the subfolder", (r.j.folders ?? []).some((f) => f.id === subId));

r = await call(`/api/folders?campaignId=${campId}`);
ok("campaign top-level STILL excludes the nested subfolder", !(r.j.folders ?? []).some((f) => f.id === subId) && (r.j.folders ?? []).length === topCount);

// cleanup
await w.from("folders").delete().eq("id", subId);
await admin.auth.admin.deleteUser(cu.data.user.id);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
