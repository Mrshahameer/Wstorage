// AI call log, usage stats and reply feedback (migration 0009). Every function
// here degrades quietly if the tables do not exist yet. SERVER ONLY.
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CallLog } from "./agent";

export async function saveCallLogs(userId: string | null, logs: CallLog[]): Promise<void> {
  if (!logs.length) return;
  try {
    await supabaseAdmin().from("ai_calls").insert(
      logs.map((l) => ({
        user_id: userId,
        provider: l.provider,
        model: l.model,
        key_id: l.keyId,
        status: l.status,
        http_status: l.http ?? null,
        latency_ms: Math.round(l.latencyMs),
        round: l.round,
        error: l.error ? l.error.slice(0, 500) : null,
      })),
    );
  } catch { /* logging must never break the assistant */ }
}

export interface ModelUsage {
  provider: string;
  model: string;
  calls: number;
  ok: number;
  quota: number;
  rateLimited: number;
  failed: number;
  avgMs: number;
}
export interface Usage {
  since: string;
  models: ModelUsage[];
  perKey: { keyId: string; calls: number; ok: number; lastStatus: string; lastAt: string }[];
  lastError: { at: string; provider: string; model: string; status: string; error: string | null } | null;
}

/** Usage over the last 24 hours, or null when the log table is missing. */
export async function aiUsage(): Promise<Usage | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data, error } = await supabaseAdmin()
    .from("ai_calls")
    .select("created_at,provider,model,key_id,status,latency_ms,error")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) return null;
  const rows = (data ?? []) as { created_at: string; provider: string; model: string; key_id: string | null; status: string; latency_ms: number | null; error: string | null }[];

  const models = new Map<string, ModelUsage & { msSum: number }>();
  const keys = new Map<string, { keyId: string; calls: number; ok: number; lastStatus: string; lastAt: string }>();
  for (const r of rows) {
    const k = `${r.provider}|${r.model}`;
    const m = models.get(k) ?? { provider: r.provider, model: r.model, calls: 0, ok: 0, quota: 0, rateLimited: 0, failed: 0, avgMs: 0, msSum: 0 };
    m.calls++;
    if (r.status === "ok") { m.ok++; m.msSum += r.latency_ms ?? 0; }
    else if (r.status === "quota") m.quota++;
    else if (r.status === "rate_limited") m.rateLimited++;
    else m.failed++;
    models.set(k, m);
    if (r.key_id) {
      const kk = keys.get(r.key_id) ?? { keyId: r.key_id, calls: 0, ok: 0, lastStatus: r.status, lastAt: r.created_at };
      kk.calls++;
      if (r.status === "ok") kk.ok++;
      keys.set(r.key_id, kk);
    }
  }
  const err = rows.find((r) => r.status !== "ok");
  return {
    since,
    models: [...models.values()].map(({ msSum, ...m }) => ({ ...m, avgMs: m.ok ? Math.round(msSum / m.ok) : 0 })).sort((a, b) => b.calls - a.calls),
    perKey: [...keys.values()],
    lastError: err ? { at: err.created_at, provider: err.provider, model: err.model, status: err.status, error: err.error } : null,
  };
}

export async function saveFeedback(f: { userId: string; rating: 1 | -1; query: string; reply: string; meta: unknown }): Promise<boolean> {
  const { error } = await supabaseAdmin().from("ai_feedback").insert({
    user_id: f.userId,
    rating: f.rating,
    query: f.query.slice(0, 4000),
    reply: f.reply.slice(0, 4000),
    meta: f.meta ?? null,
  });
  return !error;
}

export async function recentFeedback(limit = 20) {
  const { data, error } = await supabaseAdmin()
    .from("ai_feedback")
    .select("id,created_at,rating,query,reply,meta")
    .eq("rating", -1)
    .order("created_at", { ascending: false })
    .limit(limit);
  return error ? null : data ?? [];
}
