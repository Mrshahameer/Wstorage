// Provider factory. Loads credentials from the DB (storage_keys), decrypts,
// and returns a ready StorageProvider. Everything else in the app calls these.
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { StorageKeyRecord, StorageProvider } from "./types";
import { BackblazeProvider } from "./backblaze";
import { R2Provider } from "./r2";

function build(record: StorageKeyRecord): StorageProvider {
  switch (record.provider) {
    case "backblaze":
      return new BackblazeProvider(record);
    case "r2":
      return new R2Provider(record);
    default:
      throw new Error(`Unsupported provider: ${record.provider}`);
  }
}

/** The currently active key used for NEW uploads. */
export async function getActiveProvider(): Promise<StorageProvider> {
  const { data, error } = await supabaseAdmin()
    .from("storage_keys")
    .select("*")
    .eq("is_active", true)
    .eq("status", "active")
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error("No active storage key configured. Add one in Settings > Storage Keys.");
  }
  return build(data as StorageKeyRecord);
}

/** The provider that a specific stored file lives on (may be a now-revoked key,
 *  which still works for reads/downloads as long as the B2 key isn't deleted upstream). */
export async function getProviderForKeyId(storageKeyId: string): Promise<StorageProvider> {
  const { data, error } = await supabaseAdmin()
    .from("storage_keys")
    .select("*")
    .eq("id", storageKeyId)
    .single();
  if (error || !data) throw new Error("Storage key not found for this file.");
  return build(data as StorageKeyRecord);
}
