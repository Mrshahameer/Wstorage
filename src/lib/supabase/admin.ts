// Service-role client. SERVER ONLY. Bypasses RLS — never import in client code.
// Defaults to the `wstorage` schema so this product's tables stay isolated from
// anything else in the same Supabase project. Every .from()/.rpc() call resolves
// to wstorage.* automatically — no per-query changes needed.
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: ReturnType<typeof createClient> | null = null;

export function supabaseAdmin() {
  if (cached) return cached;
  cached = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    db: { schema: "wstorage" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
