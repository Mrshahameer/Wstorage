// Server-side CRUD for storage credentials (Backblaze B2 or Cloudflare R2)
// managed from the dashboard. Secrets are encrypted before storage; the
// secret is NEVER returned to clients.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

export type StorageProviderName = "backblaze" | "r2";

export interface AddKeyInput {
  provider?: StorageProviderName; // defaults to "backblaze" for backwards compatibility
  label: string;
  keyId: string;          // B2 applicationKeyId, or R2 Access Key ID
  applicationKey: string; // B2 applicationKey secret, or R2 Secret Access Key
  bucketId: string;
  bucketName: string;
  region: string;
  /** Cloudflare account ID. Required when provider === "r2", ignored otherwise. */
  accountId?: string;
  makeActive?: boolean;
}

export async function addStorageKey(input: AddKeyInput, createdBy: string) {
  const db = supabaseAdmin();
  const provider: StorageProviderName = input.provider || "backblaze";

  if (provider === "r2" && !input.accountId?.trim()) {
    throw new Error("Cloudflare account ID is required for R2 keys.");
  }

  // If this key should be active, clear the current active flag first.
  // Only one key may be active at a time GLOBALLY (across all providers) —
  // new uploads always go to a single active provider.
  if (input.makeActive) {
    await db.from("storage_keys").update({ is_active: false }).eq("is_active", true);
  }

  const { data, error } = await db
    .from("storage_keys")
    .insert({
      provider,
      label: input.label,
      key_id: input.keyId,
      secret_encrypted: encryptSecret(input.applicationKey),
      bucket_id: input.bucketId || null,
      bucket_name: input.bucketName,
      region: provider === "r2" ? "auto" : input.region,
      account_id: provider === "r2" ? input.accountId!.trim() : null,
      is_active: !!input.makeActive,
      status: "active",
      created_by: createdBy,
    })
    .select("id,provider,label,key_id,bucket_name,region,account_id,is_active,status,created_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Revoke a key. If it was active, the caller should activate another one. */
export async function revokeStorageKey(id: string) {
  const db = supabaseAdmin();
  const { error } = await db
    .from("storage_keys")
    .update({ status: "revoked", is_active: false, revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Make one key the active upload target; deactivates all others. */
export async function activateStorageKey(id: string) {
  const db = supabaseAdmin();
  // Ensure it isn't revoked.
  const { data: key } = await db.from("storage_keys").select("status").eq("id", id).single();
  if (!key || key.status !== "active") throw new Error("Cannot activate a revoked key.");

  await db.from("storage_keys").update({ is_active: false }).eq("is_active", true);
  const { error } = await db.from("storage_keys").update({ is_active: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Safe list for the dashboard (no secrets). */
export async function listStorageKeys() {
  const { data, error } = await supabaseAdmin()
    .from("storage_keys")
    .select("id,provider,label,key_id,bucket_name,region,account_id,is_active,status,created_at,revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
