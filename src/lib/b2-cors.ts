// Sets an UPLOAD-permitting CORS rule on a Backblaze B2 bucket using B2's
// native API (server -> B2, no browser CORS involved). Requires the storage
// key to have the `writeBuckets` capability.
import { decryptSecret } from "@/lib/crypto";
import type { StorageKeyRecord } from "@/lib/storage/types";

export async function enableB2Cors(key: StorageKeyRecord, origin: string) {
  const keyId = key.key_id;
  const appKey = decryptSecret(key.secret_encrypted);
  const bucketName = key.bucket_name;

  const auth = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: "Basic " + Buffer.from(`${keyId}:${appKey}`).toString("base64") },
  }).then((r) => r.json());
  if (!auth.apiUrl) throw new Error("Backblaze auth failed: " + (auth.message || "check key id/secret"));
  const { apiUrl, authorizationToken, accountId } = auth;

  const list = await fetch(`${apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: { Authorization: authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, bucketName }),
  }).then((r) => r.json());
  const bucket = (list.buckets || []).find((b: { bucketName: string }) => b.bucketName === bucketName);
  if (!bucket) throw new Error(`Bucket "${bucketName}" not found for this key's account.`);

  const origins = Array.from(new Set([origin, "https://*.vercel.app"].filter(Boolean)));
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

  const upd = await fetch(`${apiUrl}/b2api/v2/b2_update_bucket`, {
    method: "POST",
    headers: { Authorization: authorizationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, bucketId: bucket.bucketId, corsRules }),
  }).then((r) => r.json());
  if (!upd.corsRules) {
    throw new Error("CORS update failed: " + (upd.message || "key may lack writeBuckets capability"));
  }
  return { origins, bucket: bucketName };
}
