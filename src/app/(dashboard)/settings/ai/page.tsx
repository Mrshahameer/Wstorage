"use client";
import { useCallback, useEffect, useState } from "react";

interface AiKey {
  id: string;
  provider: "gemini" | "groq";
  label: string;
  status: string;
  cooldown_until: string | null;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}
interface Settings {
  provider_order: ("gemini" | "groq")[];
  enabled: boolean;
  gemini_model: string;
  groq_model: string;
}

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const providerLabel = (p: string) => (p === "gemini" ? "Google AI Studio (Gemini)" : "Groq (Llama)");

export default function AiControlPage() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [settings, setSettings] = useState<Settings>({ provider_order: ["gemini", "groq"], enabled: true, gemini_model: "gemini-flash-latest", groq_model: "openai/gpt-oss-120b" });
  const [geminiModel, setGeminiModel] = useState("");
  const [groqModel, setGroqModel] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notReady, setNotReady] = useState(false);

  const [provider, setProvider] = useState<"gemini" | "groq">("gemini");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  const j = async (u: string, init?: RequestInit) => {
    const r = await fetch(u, init);
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, body };
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, body } = await j("/api/ai-keys");
    setLoading(false);
    if (!ok) {
      // Most likely the 0008 migration has not been run yet.
      setNotReady(true);
      setError(body.error || "AI tables are not set up yet.");
      return;
    }
    setNotReady(false);
    setKeys(body.keys ?? []);
    if (body.settings) {
      setSettings(body.settings);
      setGeminiModel(body.settings.gemini_model ?? "");
      setGroqModel(body.settings.groq_model ?? "");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addKey() {
    setBusy(true); setError("");
    const { ok, body } = await j("/api/ai-keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, label: label.trim() || providerLabel(provider), apiKey }),
    });
    setBusy(false);
    if (!ok) return setError(body.error || "Failed to add key");
    setApiKey(""); setLabel(""); load();
  }
  async function removeKey(id: string) {
    if (!confirm("Delete this API key?")) return;
    await j(`/api/ai-keys/${id}`, { method: "DELETE" });
    load();
  }
  async function saveSettings(next: Partial<Settings>) {
    const merged = { ...settings, ...next };
    setSettings(merged);
    await j("/api/ai-keys", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
  }
  const moveProvider = (p: "gemini" | "groq") => {
    const rest = settings.provider_order.filter((x) => x !== p);
    saveSettings({ provider_order: [p, ...rest] });
  };

  const byProvider = (p: "gemini" | "groq") => keys.filter((k) => k.provider === p);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Control</h1>
        <p className="mt-1 text-sm text-slate-500">
          Add provider keys for the Search Assistant. Add as many as you want. The assistant rotates across them and fails over when one is rate-limited.
        </p>
      </div>

      {notReady && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          The AI tables are not set up yet. Run migration <code>supabase/migrations/0008_ai_assistant.sql</code> in the Supabase SQL editor, then reload this page.
        </div>
      )}
      {error && !notReady && <p className="text-sm text-rose-600">{error}</p>}

      {!notReady && (
        <>
          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-800">Add an API key</h2>
            <p className="text-xs text-slate-500">Keys are encrypted before storage and never shown again.</p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Provider</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value as "gemini" | "groq")} className={input}>
                  <option value="gemini">Google AI Studio (Gemini)</option>
                  <option value="groq">Groq (Llama)</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Label</span>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Gemini key 1" className={input + " w-48"} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">API key</span>
                <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder="paste key" className={input + " w-64"} />
              </label>
              <button onClick={addKey} disabled={busy || apiKey.trim().length < 10} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
                {busy ? "Adding…" : "Add key"}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Assistant</h2>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={settings.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} className="rounded" />
                Use AI (off = keyword search only)
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span>Try first:</span>
              {settings.provider_order.map((p, i) => (
                <button
                  key={p}
                  onClick={() => moveProvider(p)}
                  className={"rounded-full px-2.5 py-0.5 text-xs font-medium " + (i === 0 ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  {i + 1}. {p === "gemini" ? "Gemini" : "Groq"}
                </button>
              ))}
              <span className="text-xs text-slate-400">click a provider to make it first</span>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500">Models (advanced)</p>
              <p className="mb-2 text-xs text-slate-400">Change these if a provider deprecates a model. No code change needed.</p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-slate-600">Gemini model</span>
                  <input value={geminiModel} onChange={(e) => setGeminiModel(e.target.value)} className={input + " w-56"} placeholder="gemini-flash-latest" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-slate-600">Groq model</span>
                  <input value={groqModel} onChange={(e) => setGroqModel(e.target.value)} className={input + " w-56"} placeholder="openai/gpt-oss-120b" />
                </label>
                <button
                  onClick={() => saveSettings({ gemini_model: geminiModel.trim() || undefined, groq_model: groqModel.trim() || undefined })}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Save models
                </button>
              </div>
            </div>
          </section>

          {(["gemini", "groq"] as const).map((p) => (
            <section key={p} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-3 text-sm font-semibold text-slate-700">
                {providerLabel(p)} <span className="text-slate-400 font-normal">· {byProvider(p).length} key{byProvider(p).length === 1 ? "" : "s"}</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-50">
                  {byProvider(p).map((k) => {
                    const cooling = k.cooldown_until && new Date(k.cooldown_until).getTime() > Date.now();
                    return (
                      <tr key={k.id} className="hover:bg-slate-50/70">
                        <td className="px-5 py-3 font-medium text-slate-800">{k.label}</td>
                        <td className="px-5 py-3">
                          {cooling
                            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">cooling down</span>
                            : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">active</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button onClick={() => removeKey(k.id)} className="text-xs text-rose-600 hover:underline">Delete</button>
                        </td>
                      </tr>
                    );
                  })}
                  {byProvider(p).length === 0 && (
                    <tr><td className="px-5 py-6 text-center text-sm text-slate-400">No {providerLabel(p)} keys yet.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          ))}

          {loading && <p className="text-sm text-slate-400">Loading…</p>}
        </>
      )}
    </div>
  );
}
