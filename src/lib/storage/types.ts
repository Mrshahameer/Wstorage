// Generic storage contract. The rest of the app depends ONLY on this,
// never on a specific provider. Add S3/GCS/R2 later by implementing it.

export interface PresignedUpload {
  url: string;          // PUT here directly from the client
  method: "PUT";
  headers: Record<string, string>;
  objectKey: string;
  expiresInSeconds: number;
}

export interface StorageProvider {
  readonly name: string;        // 'backblaze' | 'r2'
  readonly storageKeyId: string; // DB id of the credential backing this provider

  /** Presigned PUT URL so large files upload straight to storage (skips our server). */
  createUploadUrl(objectKey: string, contentType: string, expiresInSeconds: number): Promise<PresignedUpload>;

  /** Short-lived GET URL for downloads. Never hand out permanent links. */
  createDownloadUrl(objectKey: string, expiresInSeconds: number, downloadName?: string): Promise<string>;

  /** Small server-side uploads (thumbnails etc.). */
  put(objectKey: string, body: Uint8Array | Buffer, contentType: string): Promise<void>;

  delete(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
  headSize(objectKey: string): Promise<number | null>;
}

export interface StorageKeyRecord {
  id: string;
  provider: "backblaze" | "r2";
  label: string;
  key_id: string;
  secret_encrypted: string;
  bucket_id: string | null;
  bucket_name: string;
  region: string;
  /** Cloudflare account ID — only set (and only needed) for provider === 'r2'.
   *  Used to build the R2 endpoint: https://<account_id>.r2.cloudflarestorage.com */
  account_id: string | null;
  is_active: boolean;
  status: "active" | "revoked";
}
