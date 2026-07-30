// Cloudflare R2 provider via its S3-compatible API.
// R2 speaks the same S3 API as Backblaze does, so this mirrors backblaze.ts —
// the only real differences are the endpoint shape and the fixed "auto" region.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PresignedUpload, StorageProvider, StorageKeyRecord } from "./types";
import { decryptSecret } from "@/lib/crypto";

export class R2Provider implements StorageProvider {
  readonly name = "r2";
  readonly storageKeyId: string;
  private client: S3Client;
  private bucket: string;

  constructor(record: StorageKeyRecord) {
    if (!record.account_id) {
      throw new Error("R2 storage key is missing its Cloudflare account_id.");
    }
    this.storageKeyId = record.id;
    this.bucket = record.bucket_name;
    const endpoint = `https://${record.account_id}.r2.cloudflarestorage.com`;
    this.client = new S3Client({
      // R2's S3 API always uses the "auto" region; anything else is ignored/aliased.
      region: "auto",
      endpoint,
      forcePathStyle: true,
      // Same reasoning as the Backblaze provider: the AWS SDK's newer default of
      // adding automatic CRC32 checksums to PutObject breaks browser presigned
      // uploads (the browser never sends the resulting x-amz-checksum header),
      // and R2 doesn't need it either. Only checksum when actually required.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: record.key_id,
        secretAccessKey: decryptSecret(record.secret_encrypted),
      },
    });
  }

  async createUploadUrl(
    objectKey: string,
    contentType: string,
    expiresInSeconds: number
  ): Promise<PresignedUpload> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": contentType },
      objectKey,
      expiresInSeconds,
    };
  }

  async createDownloadUrl(
    objectKey: string,
    expiresInSeconds: number,
    downloadName?: string
  ): Promise<string> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replace(/"/g, "")}"`
        : undefined,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresInSeconds });
  }

  async put(objectKey: string, body: Uint8Array | Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: body, ContentType: contentType })
    );
  }

  async delete(objectKey: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return true;
    } catch {
      return false;
    }
  }

  async headSize(objectKey: string): Promise<number | null> {
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey })
      );
      return r.ContentLength ?? null;
    } catch {
      return null;
    }
  }
}
