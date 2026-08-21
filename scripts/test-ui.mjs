// Live E2E for the blueprint UI backends: analytics, activity, permission grants,
// access enforcement (grant -> user sees only granted campaign), and search filters.
// Run: node --env-file=.env.local scripts/test-ui.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import crypto from "node:crypto";

const BASE = "http://localhost:3222";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"} ${l}${e ? " — " + e : ""}`); c ? pass++ : fail++; };

async function makeUser(role) {
  const email = `zz_ui_${role}_${Date.now()}_${Math.floor(Math.random()*1e4)}@example.com`;
  const password = "Test-" + Math.random().toString(36).slice(2) + "!9";
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const id = cu.data.user.id;
  await w.from("profiles").update({ role }).eq("id", id);
  const jar = {};
  const ssr = createServerClient(url, anon, { cookies: { getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => { jar[name] = value; }) } });
  await ssr.auth.signInWithPassword({ email, password });
  const cookie = Object.entries(jar).map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
  return { id, email, cookie };
}
const call = async (cookie, path, method = "GET", body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
};

async function main() {
  const boss = await makeUser("super_admin");
  const bd = await makeUser("bd_manager");

  // Build a taxonomy + two campaigns with one file each, in a real folder (not shared pool).
  const tag = "ZZUI_" + Date.now();
  const cat = await w.from("categories").insert({ name: tag + "_c" }).select("id").single();
  const vert = await w.from("verticals").insert({ category_id: cat.data.id, name: tag + "_v" }).select("id").single();
  const cA = await w.from("campaigns").insert({ vertical_id: vert.data.id, name: tag + "_A" }).select("id").single();
  const cB = await w.from("campaigns").insert({ vertical_id: vert.data.id, name: tag + "_B" }).select("id").single();
  const folder = await w.from("folders").insert({ name: tag + "_f", path: "/" + tag }).select("id").single();
  const fA = await w.from("files").insert({ name: tag + "_A.mp4", extension: "mp4", object_key: `2026/${crypto.randomUUID()}.mp4`, folder_id: folder.data.id, category_id: cat.data.id, vertical_id: vert.data.id, campaign_id: cA.data.id, status: "ready", size_bytes: 1 }).select("id").single();
  const fB = await w.from("files").insert({ name: tag + "_B.pdf", extension: "pdf", object_key: `2026/${crypto.randomUUID()}.pdf`, folder_id: folder.data.id, category_id: cat.data.id, vertical_id: vert.data.id, campaign_id: cB.data.id, status: "ready", size_bytes: 1 }).select("id").single();

  // 1) analytics + activity (admin)
  let r = await call(boss.cookie, "/api/analytics");
  ok("GET /api/analytics -> 200 w/ totals", r.status === 200 && typeof r.j?.totals?.assets === "number", `status ${r.status}`);
  r = await call(boss.cookie, "/api/activity?limit=10");
  ok("GET /api/activity -> 200 w/ logs array", r.status === 200 && Array.isArray(r.j?.logs), `status ${r.status}`);

  // 2) bd_manager sees NOTHING from this folder before any grant
  r = await call(bd.cookie, `/api/files?categoryId=${cat.data.id}`);
  const beforeIds = (r.j?.files ?? []).map((f) => f.id);
  ok("bd_manager sees neither file before grant", r.status === 200 && !beforeIds.includes(fA.data.id) && !beforeIds.includes(fB.data.id), `saw ${beforeIds.length}`);

  // 3) Grant bd_manager ONLY campaign A (via permissions API, as super_admin)
  r = await call(boss.cookie, "/api/permissions", "POST", { userId: bd.id, nodes: [{ type: "campaign", id: cA.data.id }] });
  ok("POST /api/permissions grant campaign A -> 200", r.status === 200, `status ${r.status} ${r.j?.error || ""}`);
  r = await call(boss.cookie, `/api/permissions?userId=${bd.id}`);
  ok("GET /api/permissions returns the granted node", r.status === 200 && (r.j?.nodes ?? []).some((n) => n.resource_id === cA.data.id), `status ${r.status}`);

  // 4) Now bd_manager sees file A but NOT file B (access enforcement)
  r = await call(bd.cookie, `/api/files`);
  const afterIds = (r.j?.files ?? []).map((f) => f.id);
  ok("bd_manager NOW sees campaign-A file", afterIds.includes(fA.data.id));
  ok("bd_manager STILL cannot see campaign-B file", !afterIds.includes(fB.data.id));

  // 5) Search filters (admin)
  r = await call(boss.cookie, `/api/files?categoryId=${cat.data.id}&ext=mp4`);
  const exts = (r.j?.files ?? []);
  ok("search ext=mp4 returns only mp4 in this category", r.status === 200 && exts.some((f) => f.id === fA.data.id) && !exts.some((f) => f.id === fB.data.id));
  r = await call(boss.cookie, `/api/files?campaignId=${cB.data.id}`);
  ok("files include resource-type embed field", r.status === 200 && "resource_types" in (r.j.files[0] || { resource_types: null }));

  // cleanup
  await w.from("user_resource_permissions").delete().eq("user_id", bd.id);
  await w.from("files").delete().in("id", [fA.data.id, fB.data.id]);
  await w.from("folders").delete().eq("id", folder.data.id);
  await w.from("campaigns").delete().in("id", [cA.data.id, cB.data.id]);
  await w.from("verticals").delete().eq("id", vert.data.id);
  await w.from("categories").delete().eq("id", cat.data.id);
  await admin.auth.admin.deleteUser(boss.id);
  await admin.auth.admin.deleteUser(bd.id);
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
