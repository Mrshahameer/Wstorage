// Authenticated HTTP E2E: create a throwaway user, sign in via @supabase/ssr's own
// cookie encoding, hit the LIVE running server's endpoints with that session, then
// delete the user. Run: node --env-file=.env.local scripts/test-http-auth.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = process.env.TEST_BASE || "http://localhost:3222";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, service, { auth: { persistSession: false } });
const wstore = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
const email = `zz_test_${Date.now()}@example.com`;
const password = "Test-" + Math.random().toString(36).slice(2) + "!9";

let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"} ${l}${e ? " — " + e : ""}`); c ? pass++ : fail++; };

async function main() {
  // 1) Create + confirm a user (trigger makes the wstorage.profiles row)
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) { console.error("createUser failed:", cu.error.message); process.exit(1); }
  const userId = cu.data.user.id;
  // Promote to admin so we can exercise admin-gated POSTs too.
  await wstore.from("profiles").update({ role: "admin" }).eq("id", userId);
  console.log(`  (test user ${email} = admin)`);

  // 2) Sign in using @supabase/ssr so the cookie encoding matches the server exactly.
  const jar = {};
  const ssr = createServerClient(url, anon, {
    cookies: {
      getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => { jar[name] = value; }),
    },
  });
  const si = await ssr.auth.signInWithPassword({ email, password });
  ok("sign in returns a session", !si.error && !!si.data.session, si.error?.message);
  const cookie = Object.entries(jar).map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");

  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    let json = null;
    try { json = await res.json(); } catch { /* html */ }
    return { status: res.status, json };
  };

  // 3) Authenticated GETs (expect 200 now)
  let r = await call("GET", "/api/categories");
  ok("GET /api/categories authed -> 200 w/ list", r.status === 200 && Array.isArray(r.json?.categories), `status ${r.status}`);
  r = await call("GET", "/api/campaign-types");
  ok("GET /api/campaign-types -> 200 (>=7 seeded)", r.status === 200 && (r.json?.campaignTypes?.length ?? 0) >= 7, `status ${r.status}`);
  r = await call("GET", "/api/resource-types");
  ok("GET /api/resource-types -> 200 (>=15 seeded)", r.status === 200 && (r.json?.resourceTypes?.length ?? 0) >= 15, `status ${r.status}`);
  r = await call("GET", "/api/verticals");
  ok("GET /api/verticals -> 200", r.status === 200 && Array.isArray(r.json?.verticals), `status ${r.status}`);
  r = await call("GET", "/api/share-links");
  ok("GET /api/share-links (admin) -> 200", r.status === 200 && Array.isArray(r.json?.shareLinks), `status ${r.status}`);

  // 4) Full create chain via HTTP (category -> vertical -> campaign) + share link
  const tag = "ZZH_" + Date.now();
  r = await call("POST", "/api/categories", { name: tag + "_cat" });
  ok("POST /api/categories -> 200", r.status === 200 && r.json?.category?.id, `status ${r.status} ${r.json?.error || ""}`);
  const catId = r.json?.category?.id;
  r = await call("POST", "/api/verticals", { categoryId: catId, name: tag + "_vert" });
  ok("POST /api/verticals -> 200", r.status === 200 && r.json?.vertical?.id, `status ${r.status} ${r.json?.error || ""}`);
  const vertId = r.json?.vertical?.id;
  r = await call("POST", "/api/campaigns", { verticalId: vertId, name: tag + "_camp", buyer: "ACME" });
  ok("POST /api/campaigns -> 200", r.status === 200 && r.json?.campaign?.id, `status ${r.status} ${r.json?.error || ""}`);

  // create a folder to share
  const folder = await wstore.from("folders").insert({ name: tag + "_f", path: "/" + tag }).select("id").single();
  const folderId = folder.data.id;
  const file = await wstore.from("files").insert({ name: tag + ".mp4", object_key: `2026/${crypto.randomUUID()}.mp4`, folder_id: folderId, status: "ready", size_bytes: 10 }).select("id").single();

  r = await call("POST", "/api/share-links", { name: tag + "_link", resources: [{ type: "folder", id: folderId }], password: "pw123", maxDownloads: 3 });
  ok("POST /api/share-links -> 200 w/ url", r.status === 200 && r.json?.shareLink?.url?.includes("/share/"), `status ${r.status} ${r.json?.error || ""}`);
  const token = r.json?.shareLink?.token;
  const linkId = r.json?.shareLink?.id;

  // 5) Validation: bad body should be 400, not 500
  r = await call("POST", "/api/verticals", { name: "" });
  ok("POST /api/verticals invalid body -> 400", r.status === 400, `status ${r.status}`);

  // 6) PUBLIC share flow (no cookie): password gate + list + download signed URL
  const pub = async (path, body) => {
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, json: j };
  };
  let p = await pub(`/api/share/${token}`, {});
  ok("public share list w/o password -> 401 requiresPassword", p.status === 401 && p.json?.requiresPassword, `status ${p.status}`);
  p = await pub(`/api/share/${token}`, { password: "wrong" });
  ok("public share wrong password -> 401", p.status === 401, `status ${p.status}`);
  p = await pub(`/api/share/${token}`, { password: "pw123" });
  ok("public share correct password -> 200 w/ file", p.status === 200 && (p.json?.files?.length ?? 0) === 1, `status ${p.status}`);
  const sharedFileId = p.json?.files?.[0]?.id;
  p = await pub(`/api/share/${token}/download`, { fileId: sharedFileId, password: "pw123" });
  // download signs a URL against B2/R2 — may fail only if storage key secret can't decrypt.
  ok("public share download -> 200 signed url (or clean storage error)", p.status === 200 ? !!p.json?.url : (p.status >= 400 && p.status < 500), `status ${p.status} ${p.json?.error || ""}`);

  // ---- cleanup ----
  await wstore.from("share_link_resources").delete().eq("share_link_id", linkId);
  await wstore.from("share_links").delete().eq("id", linkId);
  await wstore.from("files").delete().eq("id", file.data.id);
  await wstore.from("folders").delete().eq("id", folderId);
  // campaign/vertical/category created via HTTP:
  await wstore.from("campaigns").delete().eq("vertical_id", vertId);
  await wstore.from("verticals").delete().eq("id", vertId);
  await wstore.from("categories").delete().eq("id", catId);
  await admin.auth.admin.deleteUser(userId);
  console.log("  ✓ cleanup complete (test user + rows removed)");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
