// Verify Campaign Library data flow: categories -> verticals -> campaigns -> files?campaignId
// Run: node --env-file=.env.local scripts/test-library.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import crypto from "node:crypto";

const BASE = "http://localhost:3222";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
const email = `zz_lib_${Date.now()}@example.com`, password = "Test-" + Math.random().toString(36).slice(2) + "!9";
let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"} ${l}${e ? " — " + e : ""}`); c ? pass++ : fail++; };

const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = cu.data.user.id;
await w.from("profiles").update({ role: "admin" }).eq("id", userId);
const jar = {};
const ssr = createServerClient(url, anon, { cookies: { getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => { jar[name] = value; }) } });
await ssr.auth.signInWithPassword({ email, password });
const cookie = Object.entries(jar).map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");
const get = async (p) => { const r = await fetch(`${BASE}${p}`, { headers: { Cookie: cookie } }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j }; };

const tag = "ZZL_" + Date.now();
const cat = await w.from("categories").insert({ name: tag + "_c" }).select("id").single();
const vert = await w.from("verticals").insert({ category_id: cat.data.id, name: tag + "_v" }).select("id").single();
const camp = await w.from("campaigns").insert({ vertical_id: vert.data.id, name: tag + "_camp" }).select("id").single();
const other = await w.from("campaigns").insert({ vertical_id: vert.data.id, name: tag + "_other" }).select("id").single();
const fA = await w.from("files").insert({ name: tag + "_A.png", object_key: `2026/${crypto.randomUUID()}.png`, campaign_id: camp.data.id, status: "ready", size_bytes: 1 }).select("id").single();
await w.from("files").insert({ name: tag + "_B.png", object_key: `2026/${crypto.randomUUID()}.png`, campaign_id: other.data.id, status: "ready", size_bytes: 1 });

let r = await get(`/api/verticals?categoryId=${cat.data.id}`);
ok("verticals?categoryId returns the vertical", r.status === 200 && r.j.verticals.some((v) => v.id === vert.data.id));
r = await get(`/api/campaigns?verticalId=${vert.data.id}`);
ok("campaigns?verticalId returns both campaigns", r.status === 200 && r.j.campaigns.length >= 2);
r = await get(`/api/files?campaignId=${camp.data.id}`);
ok("files?campaignId returns ONLY that campaign's file", r.status === 200 && r.j.files.length === 1 && r.j.files[0].id === fA.data.id, `count ${r.j?.files?.length}`);
r = await get(`/api/files?verticalId=${vert.data.id}`);
ok("files?verticalId returns campaign files under vertical", r.status === 200, `status ${r.status}`);

// cleanup
await w.from("files").delete().eq("campaign_id", camp.data.id);
await w.from("files").delete().eq("campaign_id", other.data.id);
await w.from("campaigns").delete().eq("vertical_id", vert.data.id);
await w.from("verticals").delete().eq("id", vert.data.id);
await w.from("categories").delete().eq("id", cat.data.id);
await admin.auth.admin.deleteUser(userId);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
