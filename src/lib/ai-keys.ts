// Admin-managed AI provider keys (Gemini / Groq), with rotation + cooldown.
// Keys are encrypted with APP_ENCRYPTION_KEY, same as storage secrets, and are
// only ever read server-side. SERVER ONLY.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export type AiProvider = "gemini" | "groq";
export const AI_PROVIDERS: AiProvider[] = ["gemini", "groq"];

export interface AiKeyRow {
  id: string;
  provider: AiProvider;
  label: string;
  status: "active" | "revoked";
  cooldown_until: string | null;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}

export interface AiSettings {
  provider_order: AiProvider[];
  enabled: boolean;
  gemini_model: string;
  groq_model: string;
}

// gemini_model is a comma-separated chain tried in order (model-level failover).
// Order is from a live benchmark of native tool calling (npm run eval:assistant):
// 3.5-flash-lite made every completed decision correctly, flash-lite-latest is a
// solid backup, 3.1-flash-lite was often overloaded. All free tier. Gemma 4 is
// left out: it has no tool calling or JSON mode and answers in prose.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-flash-latest";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

/** Split a comma-separated model chain into a clean ordered list. */
export function modelList(s: string): string[] {
  const list = (s || "").split(",").map((m) => m.trim()).filter(Boolean);
  return list.length ? list : [DEFAULT_GEMINI_MODEL.split(",")[0]];
}

/** List keys without ever returning the secret. */
export async function listAiKeys(): Promise<AiKeyRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("ai_keys")
    .select("id,provider,label,status,cooldown_until,last_used_at,use_count,created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as AiKeyRow[];
}

export async function addAiKey(provider: AiProvider, label: string, apiKey: string, createdBy: string): Promise<AiKeyRow> {
  const { data, error } = await supabaseAdmin()
    .from("ai_keys")
    .insert({ provider, label, api_key_encrypted: encryptSecret(apiKey), created_by: createdBy })
    .select("id,provider,label,status,cooldown_until,last_used_at,use_count,created_at")
    .single();
  if (error) throw new Error(error.message);
  return data as AiKeyRow;
}

export async function revokeAiKey(id: string): Promise<void> {
  const { error } = await supabaseAdmin().from("ai_keys").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getAiSettings(): Promise<AiSettings> {
  const { data } = await supabaseAdmin()
    .from("ai_settings")
    .select("provider_order,enabled,gemini_model,groq_model")
    .eq("id", 1)
    .maybeSingle();
  const order = (data?.provider_order as AiProvider[] | undefined)?.filter((p) => AI_PROVIDERS.includes(p));
  // The 0008 migration seeded a single legacy model that is now slow/overloaded.
  // Treat it (and an empty value) as "use the benchmarked chain" so the app
  // self-upgrades with no migration. A real custom value is always honored.
  const stored = (data?.gemini_model || "").trim();
  const LEGACY = ["gemini-flash-latest", "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-flash-latest"];
  const gemini_model = !stored || LEGACY.includes(stored) ? DEFAULT_GEMINI_MODEL : stored;
  return {
    provider_order: order && order.length ? order : ["gemini", "groq"],
    enabled: data?.enabled ?? true,
    gemini_model,
    groq_model: data?.groq_model || DEFAULT_GROQ_MODEL,
  };
}

export async function setAiSettings(patch: Partial<AiSettings>): Promise<void> {
  const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() };
  if (patch.provider_order) row.provider_order = patch.provider_order.filter((p) => AI_PROVIDERS.includes(p));
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.gemini_model) row.gemini_model = patch.gemini_model.trim();
  if (patch.groq_model) row.groq_model = patch.groq_model.trim();
  const { error } = await supabaseAdmin().from("ai_settings").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/** Pick an active key for a provider that is not cooling down, least-recently-used first. */
export async function pickKey(provider: AiProvider): Promise<{ id: string; key: string } | null> {
  const { data } = await supabaseAdmin()
    .from("ai_keys")
    .select("id,api_key_encrypted,cooldown_until")
    .eq("provider", provider)
    .eq("status", "active")
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .limit(50);
  const now = Date.now();
  const row = (data ?? []).find(
    (r: { cooldown_until: string | null }) => !r.cooldown_until || new Date(r.cooldown_until).getTime() <= now
  );
  if (!row) return null;
  try {
    return { id: row.id, key: decryptSecret(row.api_key_encrypted) };
  } catch {
    // Key cannot be decrypted (encryption key changed). Skip it.
    return null;
  }
}

export async function markKeyUsed(id: string): Promise<void> {
  await supabaseAdmin()
    .from("ai_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id);
}

/** Put a key on cooldown after a rate-limit or error. */
export async function coolDownKey(id: string, seconds: number): Promise<void> {
  await supabaseAdmin()
    .from("ai_keys")
    .update({ cooldown_until: new Date(Date.now() + seconds * 1000).toISOString(), last_used_at: new Date().toISOString() })
    .eq("id", id);
}

/** Decrypt one key for the "Test" button in AI Control. Admin routes only. */
export async function getAiKeyForTest(id: string): Promise<{ provider: AiProvider; key: string } | null> {
  const { data } = await supabaseAdmin().from("ai_keys").select("provider,api_key_encrypted").eq("id", id).maybeSingle();
  if (!data) return null;
  return { provider: data.provider as AiProvider, key: decryptSecret(data.api_key_encrypted) };
}
