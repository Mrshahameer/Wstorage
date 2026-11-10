"use client";
import { useCallback, useEffect, useState } from "react";

interface AiKey {
  id: string;
  provider: "gemini" | "groq";
  label: string;
  status: string;
  cooldown_until: string | null;
  last_used_at: string | null;
  created_at: string;
}
interface Settings {
  provider_order: ("gemini" | "groq")[];
  enabled: boolean;
  gemini_model: string;
  groq_model: string;
}
interface ModelUsage { provider: string; model: string; calls: number; ok: number; quota: number; rateLimited: number; failed: number; avgMs: number }
interface Usage {
  models: ModelUsage[];
  perKey: { keyId: string; calls: number; ok: number }[];
  lastError: { at: string; provider: string; model: string; status: string; error: string | null } | null;
}
interface Feedback { id: number; created_at: string; query: string; reply: string; meta: { model?: string; mode?: string } | null }
type TestResult = { ok: boolean; model: string; ms: number; code?: string; error?: string };

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const providerLabel = (p: string) => (p === "gemini" ? "Google AI Studio (Gemini)" : "Groq");
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "never");
const STATUS_TEXT: Record<string, string> = {
  quota: "daily quota used up",
  rate_limited: "too many requests per minute",
  overloaded: "Google is overloaded",
  timeout: "too slow, timed out",
  auth: "key rejected",
  bad_output: "unusable answer",
  error: "request failed",
};

export default function AiControlPage() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chain, setChain] = useState<string[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [feedback, setFeedback] = useState<Feedback[] | null>(null);
  const [geminiModel, setGeminiModel] = useState("");
  const [groqModel, setGroqModel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);

  const [provider, setProvider] = useState<"gemini" | "groq">("gemini");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [tests, setTests] = useState<Record<string, TestResult | "running">>({});

  const j = async (u: string, init?: RequestInit) => {
    const r = await fetch(u, init);
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, body };
  };

  const load = useCallback(async () => {
    const { ok, body } = await j("/api/ai-keys");
    setLoading(false);
    if (!ok) { setNotReady(true); setError(body.error || "AI tables are not set up yet."); return; }
    setNotReady(false);
    setKeys(body.keys ?? []);
    setSettings(body.settings);
    setChain(body.chain ?? []);
    setUsage(body.usage ?? null);
    setFeedback(body.feedback ?? null);
    setGeminiModel(body.settings?.gemini_model ?? "");
    setGroqModel(body.settings?.groq_model ?? "");
  }, []);
  useEffect(() => { load(); }, [load]);

  const pasted = apiKey.split(/[\s,]+/).filter((k) => k.trim().length >= 10);

  async function addKeys() {
    setBusy(true); setError(""); setNotice("");
    const { ok, body } = await j("/api/ai-keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, label: label.trim() || providerLabel(provider), apiKey }),
    });
    setBusy(false);
    if (!ok) return setError(body.error || "Failed to add the key");
    setApiKey(""); setLabel("");
    setNotice(`Added ${body.added ?? 1} key${(body.added ?? 1) === 1 ? "" : "s"}. Use Test to check each one.`);
    load();
  }
  async function removeKey(id: string) {
    if (!confirm("Delete this API key?")) return;
    await j(`/api/ai-keys/${id}`, { method: "DELETE" });
    load();
  }
  async function testKey(id: string) {
    setTests((t) => ({ ...t, [id]: "running" }));
    const { body } = await j(`/api/ai-keys/${id}/test`, { method: "POST" });
    setTests((t) => ({ ...t, [id]: body as TestResult }));
  }
  async function testAll() {
    for (const k of keys) await testKey(k.id); // one at a time, to stay under per-minute limits
  }
  async function saveSettings(next: Partial<Settings>) {
    if (!settings) return;
    setSettings({ ...settings, ...next });
    await j("/api/ai-keys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    load();
  }
  const moveProvider = (p: "gemini" | "groq") => settings && saveSettings({ provider_order: [p, ...settings.provider_order.filter((x) => x !== p)] });
  const byProvider = (p: "gemini" | "groq") => keys.filter((k) => k.provider === p);
  const callsFor = (id: string) => usage?.perKey.find((k) => k.keyId === id);

  // Health summary at the top of the page.
  const quotaHits = usage?.models.reduce((n, m) => n + m.quota, 0) ?? 0;
  const okCalls = usage?.models.reduce((n, m) => n + m.ok, 0) ?? 0;
  const health = !keys.length
    ? { tone: "rose", text: "No AI keys yet. The assistant is running in keyword mode. Add at least one Gemini key below." }
    : settings && !settings.enabled
      ? { tone: "amber", text: "AI is turned off. The assistant answers in keyword mode." }
      : usage?.lastError?.status === "quota" && quotaHits > 0
        ? { tone: "amber", text: `Quota was used up ${quotaHits} time${quotaHits === 1 ? "" : "s"} in the last 24 hours. Add keys from other Google projects, or upgrade a project to the paid tier.` }
        : { tone: "emerald", text: `AI is on. ${okCalls} successful model call${okCalls === 1 ? "" : "s"} in the last 24 hours across ${keys.length} key${keys.length === 1 ? "" : "s"}.` };
  const tone: Record<string, string> = {
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Control</h1>
        <p className="mt-1 text-sm text-slate-600">
          Keys for the AI Search Assistant. Add as many as you like. The assistant rotates across them, tries the next model when one is out of quota, and falls back to keyword mode only when every key and model fails.
        </p>
      </div>

      {notReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          The AI tables are not set up yet. Run migration <code>supabase/migrations/0008_ai_assistant.sql</code> in the Supabase SQL editor, then reload this page.
        </div>
      )}
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {notice && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}

      {!notReady && settings && (
        <>
          <div className={`rounded-xl border p-4 text-sm font-medium ${tone[health.tone]}`}>{health.text}</div>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">How the limits work</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>Free Gemini limits are per <strong>Google Cloud project</strong>, per model, per day (they reset at midnight Pacific time). Several keys from the same project share one limit.</li>
              <li>To raise capacity: create keys in <strong>different projects</strong> (aistudio.google.com, then Get API key, then Create key in new project), or enable billing on a project for the paid tier.</li>
              <li>Each model in the chain has its own limit, so a longer chain also adds capacity. A Groq key adds a second provider as backup.</li>
              <li>Each question uses 1 model call, or 2 when it fetches assets.</li>
            </ul>
          </section>

          <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Add API keys</h2>
              <p className="text-xs text-slate-600">Paste one key, or many (one per line). Keys are encrypted before storage and never shown again.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Provider</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value as "gemini" | "groq")} className={input}>
                  <option value="gemini">Google AI Studio (Gemini)</option>
                  <option value="groq">Groq</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-700">Label</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Project A" className={input + " w-full"} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-700">API key(s)</span>
              <textarea value={apiKey} onChange={(e) => setApiKey(e.target.value)} rows={3} placeholder="Paste keys here, one per line"
                className={input + " w-full font-mono text-xs"} />
            </label>
            <button onClick={addKeys} disabled={busy || pasted.length === 0} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
              {busy ? "Adding…" : pasted.length > 1 ? `Add ${pasted.length} keys` : "Add key"}
            </button>
          </section>

          {(["gemini", "groq"] as const).map((p) => (
            <section key={p} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                <span className="text-sm font-semibold text-slate-800">
                  {providerLabel(p)} <span className="font-normal text-slate-500">· {byProvider(p).length} key{byProvider(p).length === 1 ? "" : "s"}</span>
                </span>
                {byProvider(p).length > 0 && <button onClick={testAll} className="text-xs font-semibold text-indigo-600 hover:underline">Test all keys</button>}
              </div>
              <ul className="divide-y divide-slate-100">
                {byProvider(p).map((k) => {
                  const cooling = k.cooldown_until && new Date(k.cooldown_until).getTime() > Date.now();
                  const t = tests[k.id];
                  const u = callsFor(k.id);
                  return (
                    <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900">{k.label}</p>
                        <p className="text-xs text-slate-500">Last used {when(k.last_used_at)}{u ? ` · ${u.ok}/${u.calls} calls ok in 24h` : ""}</p>
                        {t && t !== "running" && (
                          <p className={"mt-0.5 text-xs font-medium " + (t.ok ? "text-emerald-700" : "text-rose-700")}>
                            {t.ok ? `Works · ${t.model} answered in ${(t.ms / 1000).toFixed(1)}s` : `Failed on ${t.model}: ${STATUS_TEXT[t.code ?? "error"] ?? t.code}${t.error ? ` (${t.error.slice(0, 120)})` : ""}`}
                          </p>
                        )}
                      </div>
                      {cooling
                        ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">resting until {when(k.cooldown_until)}</span>
                        : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">active</span>}
                      <button onClick={() => testKey(k.id)} disabled={t === "running"} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                        {t === "running" ? "Testing…" : "Test"}
                      </button>
                      <button onClick={() => removeKey(k.id)} className="text-xs font-semibold text-rose-600 hover:underline">Delete</button>
                    </li>
                  );
                })}
                {byProvider(p).length === 0 && <li className="px-5 py-6 text-center text-sm text-slate-500">No {providerLabel(p)} keys yet.</li>}
              </ul>
            </section>
          ))}

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-800">Usage, last 24 hours</div>
            {usage === null ? (
              <p className="px-5 py-4 text-sm text-slate-600">Run migration <code>supabase/migrations/0009_ai_observability.sql</code> to record usage.</p>
            ) : usage.models.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-600">No model calls yet.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-[640px] w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-2 font-semibold">Model</th>
                        <th className="px-3 py-2 font-semibold">Calls</th>
                        <th className="px-3 py-2 font-semibold">OK</th>
                        <th className="px-3 py-2 font-semibold">Quota used up</th>
                        <th className="px-3 py-2 font-semibold">Rate limited</th>
                        <th className="px-3 py-2 font-semibold">Other errors</th>
                        <th className="px-3 py-2 font-semibold">Avg time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {usage.models.map((m) => (
                        <tr key={`${m.provider}|${m.model}`}>
                          <td className="px-5 py-2 font-medium text-slate-900">{m.model}</td>
                          <td className="px-3 py-2 text-slate-700">{m.calls}</td>
                          <td className="px-3 py-2 text-emerald-700">{m.ok}</td>
                          <td className={"px-3 py-2 " + (m.quota ? "font-semibold text-amber-700" : "text-slate-500")}>{m.quota}</td>
                          <td className={"px-3 py-2 " + (m.rateLimited ? "text-amber-700" : "text-slate-500")}>{m.rateLimited}</td>
                          <td className={"px-3 py-2 " + (m.failed ? "text-rose-700" : "text-slate-500")}>{m.failed}</td>
                          <td className="px-3 py-2 text-slate-700">{m.avgMs ? `${(m.avgMs / 1000).toFixed(1)}s` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {usage.lastError && (
                  <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                    Last problem: {when(usage.lastError.at)} · {usage.lastError.model} · {STATUS_TEXT[usage.lastError.status] ?? usage.lastError.status}
                    {usage.lastError.error ? ` · ${usage.lastError.error.slice(0, 160)}` : ""}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Assistant</h2>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} className="rounded" />
                Use AI (off = keyword mode only)
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
              <span>Try first:</span>
              {settings.provider_order.map((p, i) => (
                <button key={p} onClick={() => moveProvider(p)}
                  className={"rounded-full px-2.5 py-0.5 text-xs font-semibold " + (i === 0 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
                  {i + 1}. {p === "gemini" ? "Gemini" : "Groq"}
                </button>
              ))}
              <span className="text-xs text-slate-500">click a provider to make it first</span>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-700">Gemini model chain (tried in order)</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {chain.map((m, i) => <span key={m} className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700">{i + 1}. {m}</span>)}
              </div>
              <p className="mb-2 mt-2 text-xs text-slate-600">Comma-separated. If a model is out of quota, overloaded or retired, the next one answers. Change this when Google retires a model; no code change needed.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="w-full max-w-full text-sm sm:w-auto">
                  <span className="mb-1 block text-slate-700">Gemini models</span>
                  <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className={input + " w-full max-w-full font-mono text-xs sm:w-[28rem]"} />
                </label>
                <label className="w-full text-sm sm:w-auto">
                  <span className="mb-1 block text-slate-700">Groq model</span>
                  <input value={groqModel} onChange={(e) => setGroqModel(e.target.value)} className={input + " w-full font-mono text-xs sm:w-56"} />
                </label>
                <button onClick={() => saveSettings({ gemini_model: geminiModel.trim() || undefined, groq_model: groqModel.trim() || undefined })}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                  Save models
                </button>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-800">Answers marked as bad</div>
            {feedback === null ? (
              <p className="px-5 py-4 text-sm text-slate-600">Run migration 0009 to collect thumbs-down feedback.</p>
            ) : feedback.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-600">No thumbs-down yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {feedback.map((f) => (
                  <li key={f.id} className="px-5 py-3">
                    <p className="text-xs text-slate-500">{when(f.created_at)} · {f.meta?.mode === "keyword" ? "keyword mode" : f.meta?.model ?? "AI"}</p>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">{f.query}</p>
                    <p className="mt-0.5 text-sm text-slate-700">{f.reply}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
    </div>
  );
}
