// E2E for the asset detail + preview endpoints (embedded relations are the risk).
// Run: node --env-file=.env.local scripts/test-detail.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import crypto from "node:crypto";

const BASE = "http://localhost:3222";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });
const w = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
const email = `zz_detail_${Date.now()}@example.com`, password = "Test-" + Math.random().toString(36).slice(2) + "!9";
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

const tag = "ZZD_" + Date.now();
const cat = await w.from("categories").insert({ name: tag + "_c" }).select("id").single();
const vert = await w.from("verticals").insert({ category_id: cat.data.id, name: tag + "_v" }).select("id").single();
const camp = await w.from("campaigns").insert({ vertical_id: vert.data.id, name: tag + "_camp", buyer: "ACME" }).select("id").single();
const rt = await w.from("resource_types").select("id").eq("name", "Creative").single();
const folder = await w.from("folders").insert({ name: tag + "_f", path: "/" + tag }).select("id").single();
const file = await w.from("files").insert({
  name: tag + ".png", object_key: `2026/${crypto.randomUUID()}.png`, extension: "png", content_type: "image/png",
  folder_id: folder.data.id, category_id: cat.data.id, vertical_id: vert.data.id, campaign_id: camp.data.id,
  resource_type_id: rt.data?.id, status: "ready", size_bytes: 2048, tags: ["fb", "video"], description: "test asset",
}).select("id").single();
const fid = file.data.id;
// a version row
await w.from("file_versions").insert({ file_id: fid, version: 1, object_key: "x", size_bytes: 2048 });

let r = await get(`/api/files/${fid}`);
ok("GET /api/files/[id] -> 200", r.status === 200 && r.j?.file?.id === fid, `status ${r.status} ${r.j?.error || ""}`);
ok("embeds resolve (category/vertical/campaign/resource_type names)",
  r.j?.file?.categories?.name && r.j?.file?.verticals?.name && r.j?.file?.campaigns?.name && r.j?.file?.resource_types?.name,
  JSON.stringify({ c: r.j?.file?.categories, v: r.j?.file?.verticals, camp: r.j?.file?.campaigns, rt: r.j?.file?.resource_types }));
ok("versions returned", Array.isArray(r.j?.versions) && r.j.versions.length === 1);

r = await get(`/api/files/${fid}/preview`);
ok("GET preview -> controlled (200 url or clean 4xx, never 500)", r.status === 200 ? !!r.j?.url : (r.status >= 400 && r.status < 500), `status ${r.status} ${r.j?.error || ""}`);

r = await get(`/api/files/00000000-0000-0000-0000-000000000000`);
ok("GET missing file -> 404", r.status === 404, `status ${r.status}`);

// cleanup
await w.from("file_versions").delete().eq("file_id", fid);
await w.from("files").delete().eq("id", fid);
await w.from("folders").delete().eq("id", folder.data.id);
await w.from("campaigns").delete().eq("id", camp.data.id);
await w.from("verticals").delete().eq("id", vert.data.id);
await w.from("categories").delete().eq("id", cat.data.id);
await admin.auth.admin.deleteUser(userId);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
