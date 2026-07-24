// Backblaze B2 provider via its S3-compatible API.
// We use the AWS S3 SDK because it gives us clean presigned PUT/GET URLs,
// which is exactly what the PRD's "signed URL, private bucket" model needs.
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

export class BackblazeProvider implements StorageProvider {
  readonly name = "backblaze";
  readonly storageKeyId: string;
  private client: S3Client;
  private bucket: string;

  constructor(record: StorageKeyRecord) {
    this.storageKeyId = record.id;
    this.bucket = record.bucket_name;
    const endpoint = `https://s3.${record.region}.backblazeb2.com`;
    this.client = new S3Client({
      region: record.region,
      endpoint,
      // Path-style is the most reliable with Backblaze's S3 endpoint.
      forcePathStyle: true,
      // CRITICAL for Backblaze presigned PUT from a browser:
      // the AWS SDK (>=3.729) adds automatic CRC32 checksums to PutObject, which
      // makes the signature expect an x-amz-checksum header the browser never sends
      // → every browser upload 403s. Only checksum when the operation truly requires it.
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
