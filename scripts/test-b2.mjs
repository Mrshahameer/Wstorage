#!/usr/bin/env node
/**
 * Standalone Backblaze B2 pipeline test.
 *
 * Mirrors the app's real code path (src/lib/storage/backblaze.ts):
 *   1. presign a PUT   (same as /api/upload/presign)
 *   2. upload the file to that URL   (same as the browser dropzone)
 *   3. HeadObject to confirm it landed
 *   4. presign a GET   (same as /api/download/[fileId])
 *
 * If this passes, your B2 key + bucket + region are correct and the provider works.
 *
 * Usage:
 *   node scripts/test-b2.mjs                       # uploads test-assets/hello.txt
 *   node scripts/test-b2.mjs test-assets/wisko-test.png
 *   node scripts/test-b2.mjs /path/to/anything
 *
 * Reads these from .env.local (NOT the encrypted DB — this is a raw connectivity test):
 *   B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME, B2_REGION
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// --- tiny .env.local loader (no dependency) ---
function loadEnv() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    console.warn("! No .env.local found — relying on shell env vars.\n");
  }
}
loadEnv();

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`✗ Missing ${k} in .env.local`); process.exit(1); }
  return v;
};

const KEY_ID = need("B2_KEY_ID");
const APP_KEY = need("B2_APPLICATION_KEY");
const BUCKET = need("B2_BUCKET_NAME");
const REGION = process.env.B2_REGION || "us-west-004";
const KEEP = process.argv.includes("--keep");

const filePath = process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) || "test-assets/hello.txt";
const body = readFileSync(filePath);
const name = basename(filePath);
const contentType =
  name.endsWith(".png") ? "image/png" :
  name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg" :
  name.endsWith(".mp4") ? "video/mp4" :
  name.endsWith(".txt") ? "text/plain" : "application/octet-stream";

const objectKey = `_pipeline-tests/${Date.now()}-${name}`;
const endpoint = `https://s3.${REGION}.backblazeb2.com`;

const s3 = new S3Client({
  region: REGION,
  endpoint,
  credentials: { accessKeyId: KEY_ID, secretAccessKey: APP_KEY },
});

console.log(`\nWisko DAM — B2 pipeline test`);
console.log(`  endpoint : ${endpoint}`);
console.log(`  bucket   : ${BUCKET}`);
console.log(`  file     : ${filePath} (${body.length} bytes, ${contentType})`);
console.log(`  objectKey: ${objectKey}\n`);

try {
  // 1. presign PUT (app: /api/upload/presign)
  const putUrl = await getSignedUrl(
    s3, new PutObjectCommand({ Bucket: BUCKET, Key: objectKey, ContentType: contentType }),
    { expiresIn: 900 }
  );
  console.log("1/4  ✓ presigned PUT url generated");

  // 2. upload to it (app: browser dropzone XHR)
  const put = await fetch(putUrl, { method: "PUT", headers: { "Content-Type": contentType }, body });
  if (!put.ok) throw new Error(`PUT failed: ${put.status} ${await put.text()}`);
  console.log(`2/4  ✓ uploaded via presigned URL (HTTP ${put.status})`);

  // 3. confirm it landed (app: /api/upload/complete -> headSize)
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: objectKey }));
  console.log(`3/4  ✓ HeadObject confirms object exists (${head.ContentLength} bytes)`);

  // 4. presign GET (app: /api/download/[fileId])
  const getUrl = await getSignedUrl(
    s3, new GetObjectCommand({ Bucket: BUCKET, Key: objectKey }), { expiresIn: 180 }
  );
  console.log("4/4  ✓ presigned GET url (valid 180s):");
  console.log(`     ${getUrl}\n`);

  console.log("RESULT: ✅ PASS — check your Backblaze console under:");
  console.log(`        ${BUCKET} / _pipeline-tests/  (file: ${objectKey.split("/").pop()})\n`);

  if (KEEP) {
    console.log("(--keep set) leaving the object in the bucket.\n");
  } else {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objectKey }));
    console.log("Cleaned up the test object. Re-run with --keep to leave it for the console screenshot.\n");
  }
} catch (err) {
  console.error("\nRESULT: ❌ FAIL");
  console.error("  " + (err?.message || err));
  console.error("\nCommon causes:");
  console.error("  - wrong B2_REGION (must match the bucket endpoint, e.g. us-west-004)");
  console.error("  - key not authorized for THIS bucket, or missing writeFiles/readFiles capability");
  console.error("  - bucket name typo (use the exact bucket NAME, not the ID)\n");
  process.exit(1);
}
