// Server-side CRUD for Backblaze credentials managed from the dashboard.
// Secrets are encrypted before storage; the secret is NEVER returned to clients.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";

export interface AddKeyInput {
  label: string;
  keyId: string;         // B2 applicationKeyId
  applicationKey: string; // B2 secret
  bucketId: string;
  bucketName: string;
  region: string;
  makeActive?: boolean;
}

export async function addStorageKey(input: AddKeyInput, createdBy: string) {
  const db = supabaseAdmin();

  // If this key should be active, clear the current active flag first
  // (the partial unique index enforces only one active per provider).
  if (input.makeActive) {
    await db
      .from("storage_keys")
      .update({ is_active: false })
      .eq("provider", "backblaze")
      .eq("is_active", true);
  }

  const { data, error } = await db
    .from("storage_keys")
    .insert({
      provider: "backblaze",
      label: input.label,
      key_id: input.keyId,
      secret_encrypted: encryptSecret(input.applicationKey),
      bucket_id: input.bucketId,
      bucket_name: input.bucketName,
      region: input.region,
      is_active: !!input.makeActive,
      status: "active",
      created_by: createdBy,
    })
    .select("id,label,key_id,bucket_name,region,is_active,status,created_at")
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

  await db.from("storage_keys").update({ is_active: false }).eq("provider", "backblaze").eq("is_active", true);
  const { error } = await db.from("storage_keys").update({ is_active: true }).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Safe list for the dashboard (no secrets). */
export async function listStorageKeys() {
  const { data, error } = await supabaseAdmin()
    .from("storage_keys")
    .select("id,provider,label,key_id,bucket_name,region,is_active,status,created_at,revoked_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
