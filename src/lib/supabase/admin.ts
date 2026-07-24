// Service-role client. SERVER ONLY. Bypasses RLS — never import in client code.
// Runs against the `wstorage` schema so this product's tables stay isolated from
// anything else in the same Supabase project.
//
// We intentionally cast to the untyped SupabaseClient: we don't ship generated
// DB types, and pinning a custom schema makes supabase-js infer row types as
// `never` (breaking `.select("col")` field access at build time). Casting keeps
// query results as `any` for the compiler while the runtime still targets wstorage.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = env.supabaseUrl() || "https://placeholder.supabase.co";
  const key = env.supabaseServiceRoleKey() || "placeholder-service-role-key";
  cached = createClient(url, key, {
    db: { schema: "wstorage" },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as SupabaseClient;
  return cached;
}
