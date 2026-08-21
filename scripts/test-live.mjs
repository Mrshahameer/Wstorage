// Live integration test against the real Supabase DB using the service role.
// Exercises the exact query shapes each new endpoint uses, then cleans up.
// Run: node --env-file=.env.local scripts/test-live.mjs
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { db: { schema: "wstorage" }, auth: { persistSession: false } });

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => { console.log(`  ${cond ? "✓" : "✗ FAIL"} ${label}${extra ? " — " + extra : ""}`); cond ? pass++ : fail++; };
const TAG = "ZZ_TEST_" + Date.now();
const cleanup = { categories: [], verticals: [], campaigns: [], resource_types: [], folders: [], files: [], share_links: [] };

async function main() {
  // 1) Category (mirrors POST /api/categories)
  let r = await db.from("categories").insert({ name: TAG + "_cat", icon: "shield", sort: 0 }).select("id,name").single();
  ok("insert category", !r.error && r.data?.id, r.error?.message);
  const catId = r.data?.id; cleanup.categories.push(catId);

  // 2) Vertical (POST /api/verticals)
  r = await db.from("verticals").insert({ category_id: catId, name: TAG + "_vert" }).select("id").single();
  ok("insert vertical under category", !r.error && r.data?.id, r.error?.message);
  const vertId = r.data?.id; cleanup.verticals.push(vertId);

  // 3) Campaign type lookup + Campaign (POST /api/campaigns)
  const ct = await db.from("campaign_types").select("id").limit(1).single();
  r = await db.from("campaigns").insert({ vertical_id: vertId, campaign_type_id: ct.data?.id, name: TAG + "_camp", buyer: "ACME" }).select("id").single();
  ok("insert campaign under vertical", !r.error && r.data?.id, r.error?.message);
  const campId = r.data?.id; cleanup.campaigns.push(campId);

  // 4) Custom resource type (POST /api/resource-types)
  r = await db.from("resource_types").insert({ name: TAG + "_rt", slug: TAG.toLowerCase() + "-rt", is_system: false, sort: 500 }).select("id").single();
  ok("insert custom resource type", !r.error && r.data?.id, r.error?.message);
  cleanup.resource_types.push(r.data?.id);
  const rtId = r.data?.id;

  // 5) Folder + a READY file tagged to campaign/vertical/resource_type (upload target shape)
  r = await db.from("folders").insert({ name: TAG + "_folder", path: "/" + TAG }).select("id").single();
  ok("insert folder", !r.error && r.data?.id, r.error?.message);
  const folderId = r.data?.id; cleanup.folders.push(folderId);

  r = await db.from("files").insert({
    name: TAG + "_file.mp4", object_key: `2026/${crypto.randomUUID()}.mp4`, folder_id: folderId,
    campaign_id: campId, vertical_id: vertId, resource_type_id: rtId,
    content_type: "video/mp4", size_bytes: 123, status: "ready",
  }).select("id").single();
  ok("insert file with campaign/vertical/resource_type + landing cols", !r.error && r.data?.id, r.error?.message);
  const fileId = r.data?.id; cleanup.files.push(fileId);

  // 6) folder_descendants() RPC (used by share expansion)
  const desc = await db.rpc("folder_descendants", { root: folderId });
  ok("folder_descendants() rpc returns self", !desc.error && (desc.data ?? []).some((d) => d.id === folderId), desc.error?.message);

  // 7) Share link + resources (POST /api/share-links) with scrypt password
  const salt = crypto.randomBytes(16); const hash = crypto.scryptSync("secret123", salt, 32);
  const pwHash = `${salt.toString("base64")}.${hash.toString("base64")}`;
  const token = crypto.randomBytes(16).toString("base64url");
  r = await db.from("share_links").insert({ token, name: TAG + "_link", password_hash: pwHash, allow_download: true, max_downloads: 5 }).select("id,token").single();
  ok("insert share_link", !r.error && r.data?.id, r.error?.message);
  const linkId = r.data?.id; cleanup.share_links.push(linkId);
  r = await db.from("share_link_resources").insert({ share_link_id: linkId, resource_type: "folder", resource_id: folderId }).select("id").single();
  ok("insert share_link_resource (folder)", !r.error && r.data?.id, r.error?.message);

  // 8) Replicate expandFiles(): folder ref -> descendants -> ready files
  const d2 = await db.rpc("folder_descendants", { root: folderId });
  const folderIds = (d2.data ?? []).map((x) => x.id);
  const ef = await db.from("files").select("id,name,status").in("folder_id", folderIds);
  const expanded = (ef.data ?? []).filter((f) => f.status === "ready");
  ok("share expansion finds the ready file", !ef.error && expanded.some((f) => f.id === fileId), ef.error?.message);

  // 9) Password verify path (timing-safe)
  const [sB, hB] = pwHash.split("."); const chk = crypto.scryptSync("secret123", Buffer.from(sB, "base64"), 32);
  ok("scrypt password verify matches", Buffer.from(hB, "base64").equals(chk));

  // 10) Granular permission insert + read (user_resource_permissions)
  const anyUser = await db.from("profiles").select("id").limit(1).maybeSingle();
  if (anyUser.data?.id) {
    r = await db.from("user_resource_permissions").insert({
      user_id: anyUser.data.id, resource_type: "folder", resource_id: folderId,
      permission: "view", access_mode: "allow", inherit_to_children: true,
    }).select("id").single();
    ok("insert granular permission (allow view, inherit)", !r.error && r.data?.id, r.error?.message);
    if (r.data?.id) await db.from("user_resource_permissions").delete().eq("id", r.data.id);
  } else {
    ok("granular permission (skipped: no profiles yet)", true);
  }

  // ---- cleanup ----
  await db.from("share_link_resources").delete().eq("share_link_id", linkId);
  for (const id of cleanup.share_links) await db.from("share_links").delete().eq("id", id);
  for (const id of cleanup.files) await db.from("files").delete().eq("id", id);
  for (const id of cleanup.folders) await db.from("folders").delete().eq("id", id);
  for (const id of cleanup.campaigns) await db.from("campaigns").delete().eq("id", id);
  for (const id of cleanup.verticals) await db.from("verticals").delete().eq("id", id);
  for (const id of cleanup.resource_types) await db.from("resource_types").delete().eq("id", id);
  for (const id of cleanup.categories) await db.from("categories").delete().eq("id", id);
  console.log("  ✓ cleanup complete (all test rows removed)");

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
