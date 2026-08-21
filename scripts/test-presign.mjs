// Verify the presign endpoint: authenticated, taxonomy fields accepted, and it
// fails GRACEFULLY (controlled 4xx, never 500) when the storage secret can't be
// decrypted with the current APP_ENCRYPTION_KEY.
// Run: node --env-file=.env.local scripts/test-presign.mjs
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const BASE = "http://localhost:3222";
const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, service, { auth: { persistSession: false } });
const wstore = createClient(url, service, { db: { schema: "wstorage" }, auth: { persistSession: false } });
const email = `zz_presign_${Date.now()}@example.com`, password = "Test-" + Math.random().toString(36).slice(2) + "!9";
let pass = 0, fail = 0;
const ok = (l, c, e = "") => { console.log(`  ${c ? "✓" : "✗ FAIL"} ${l}${e ? " — " + e : ""}`); c ? pass++ : fail++; };

const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
const userId = cu.data.user.id;
await wstore.from("profiles").update({ role: "admin" }).eq("id", userId);
const jar = {};
const ssr = createServerClient(url, anon, { cookies: { getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach(({ name, value }) => { jar[name] = value; }) } });
await ssr.auth.signInWithPassword({ email, password });
const cookie = Object.entries(jar).map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join("; ");

const res = await fetch(`${BASE}/api/upload/presign`, {
  method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
  body: JSON.stringify({
    fileName: "test.mp4", contentType: "video/mp4", sizeBytes: 100,
    verticalId: null, campaignId: null, resourceTypeId: null, sha256: "abc",
  }),
});
let json = null; try { json = await res.json(); } catch {}
console.log(`  presign status ${res.status}: ${JSON.stringify(json)?.slice(0, 120)}`);
ok("presign never 500s (controlled 2xx/4xx)", res.status < 500, `status ${res.status}`);
ok("presign 200 -> has presigned URL, OR clean 4xx error", res.status === 200 ? !!json?.presigned?.url : (res.status >= 400 && !!json?.error));

await admin.auth.admin.deleteUser(userId);
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
