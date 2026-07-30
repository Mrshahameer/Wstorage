// Sets an UPLOAD-permitting CORS rule on a Cloudflare R2 bucket.
// Unlike Backblaze, R2 has no separate native admin API for this — R2
// implements the standard S3 PutBucketCors/GetBucketCors operations directly,
// so we just reuse the S3 SDK with the R2 credentials that are already used
// for presigned uploads/downloads.
import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { decryptSecret } from "@/lib/crypto";
import type { StorageKeyRecord } from "@/lib/storage/types";

export async function enableR2Cors(key: StorageKeyRecord, origin: string) {
  if (!key.account_id) throw new Error("R2 storage key is missing its Cloudflare account_id.");

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${key.account_id}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: key.key_id,
      secretAccessKey: decryptSecret(key.secret_encrypted),
    },
  });

  const origins = Array.from(new Set([origin, "https://*.vercel.app"].filter(Boolean)));

  await client.send(
    new PutBucketCorsCommand({
      Bucket: key.bucket_name,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            // R2's CORS implementation is picky about "*" in AllowedHeaders for
            // some browsers/requests, but "content-type" (what our presigned PUT
            // actually sends) works reliably — mirroring Backblaze's allowedHeaders
            // isn't safe to assume here, so keep this narrow and explicit.
            AllowedHeaders: ["content-type"],
            AllowedMethods: ["PUT", "GET", "HEAD"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );

  return { origins, bucket: key.bucket_name };
}
