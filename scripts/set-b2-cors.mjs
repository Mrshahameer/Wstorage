#!/usr/bin/env node
/**
 * Allow your Wstorage site to upload directly to your Backblaze bucket
 * by setting CORS rules on the bucket (browser uploads are blocked without this).
 *
 * Usage:
 *   node scripts/set-b2-cors.mjs                         # allows https://wstorage.vercel.app
 *   node scripts/set-b2-cors.mjs https://your-domain.com # allow a custom origin too
 *
 * Reads from .env.local:  B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME
 * (Your key needs writeBuckets capability — the master-style key you created has it.)
 */
import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* rely on shell env */ }
}
loadEnv();

const KEY_ID = process.env.B2_KEY_ID;
const APP_KEY = process.env.B2_APPLICATION_KEY;
const BUCKET = process.env.B2_BUCKET_NAME;
if (!KEY_ID || !APP_KEY || !BUCKET) {
  console.error("✗ Need B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME in .env.local");
  process.exit(1);
}

const extraOrigin = process.argv[2];
const origins = ["https://wstorage.vercel.app", "https://*.vercel.app"];
if (extraOrigin) origins.unshift(extraOrigin);

const corsRules = [
  {
    corsRuleName: "wstorageBrowserUpload",
    allowedOrigins: origins,
    allowedOperations: ["s3_put", "s3_get", "s3_head", "s3_post", "s3_delete"],
    allowedHeaders: ["*"],
    exposeHeaders: ["etag"],
    maxAgeSeconds: 3600,
  },
];

async function main() {
  console.log(`\nSetting CORS on bucket "${BUCKET}" for origins:\n  ${origins.join("\n  ")}\n`);

  // 1) authorize
  const auth = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: "Basic " + Buffer.from(`${KEY_ID}:${APP_KEY}`).toString("base64") },
  }).then((r) => r.json());
  if (!auth.apiUrl) throw new Error("Authorize failed: " + JSON.stringify(auth));
  const { apiUrl, authorizationToken, accountId } = auth;

  // 2) find bucketId by name
  const list = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, bucketName: BUCKET }),
  }).then((r) => r.json());
  const bucket = (list.buckets || []).find((b) => b.bucketName === BUCKET);
  if (!bucket) throw new Error(`Bucket "${BUCKET}" not found for this account.`);

  // 3) update CORS
  const upd = await fetch(`${apiUrl}/b2api/v2/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, bucketId: bucket.bucketId, corsRules }),
  }).then((r) => r.json());
  if (upd.corsRules) {
    console.log("✅ CORS set. Browser uploads to this bucket are now allowed.\n");
  } else {
    throw new Error("Update failed: " + JSON.stringify(upd));
  }
}

main().catch((e) => { console.error("\n❌ " + (e.message || e) + "\n"); process.exit(1); });
