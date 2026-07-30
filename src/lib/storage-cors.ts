// Looks up the active storage key and enables browser-upload CORS on its
// bucket using the right provider-specific mechanism.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enableB2Cors } from "@/lib/b2-cors";
import { enableR2Cors } from "@/lib/r2-cors";
import type { StorageKeyRecord } from "@/lib/storage/types";

export async function enableActiveBucketCors(origin: string) {
  const { data: key } = await supabaseAdmin()
    .from("storage_keys")
    .select("*")
    .eq("is_active", true)
    .eq("status", "active")
    .single();
  if (!key) throw new Error("No active storage key. Add one first.");

  const record = key as StorageKeyRecord;
  switch (record.provider) {
    case "backblaze":
      return enableB2Cors(record, origin);
    case "r2":
      return enableR2Cors(record, origin);
    default:
      throw new Error(`CORS setup not supported for provider: ${record.provider}`);
  }
}
