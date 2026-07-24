"use client";
import { useEffect, useState } from "react";

interface KeyRow {
  id: string; label: string; key_id: string; bucket_name: string; region: string;
  is_active: boolean; status: "active" | "revoked"; created_at: string;
}
const empty = { label: "", keyId: "", applicationKey: "", bucketId: "", bucketName: "", region: "us-west-004", makeActive: true };
const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

export function StorageKeysManager() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/storage-keys"); const j = await r.json();
    if (r.ok) setKeys(j.keys); else setError(j.error);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true); setError(null);
    const r = await fetch("/api/storage-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) return setError(typeof j.error === "string" ? j.error : "Couldn't save key");
    setForm({ ...empty }); load();
  }
  async function activate(id: string) { await fetch(`/api/storage-keys/${id}`, { method: "PATCH" }); load(); }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Files already stored with it stay downloadable; new uploads won't use it.")) return;
    await fetch(`/api/storage-keys/${id}`, { method: "DELETE" }); load();
  }
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }) as typeof form);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Add a Backblaze key</h2>
        <p className="text-sm text-slate-500 mt-1">
          Use a key scoped to one bucket. The secret is encrypted before storage and never shown again.
        </p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Label" v={form.label} on={set("label")} placeholder="e.g. Company bucket" />
          <Field label="Region" v={form.region} on={set("region")} placeholder="us-west-004" />
          <Field label="Key ID" v={form.keyId} on={set("keyId")} placeholder="applicationKeyId" />
          <Field label="Application key (secret)" v={form.applicationKey} on={set("applicationKey")} type="password" />
          <Field label="Bucket name" v={form.bucketName} on={set("bucketName")} placeholder="my-bucket" />
          <Field label="Bucket ID (optional)" v={form.bucketId} on={set("bucketId")} placeholder="leave blank if unsure" />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.makeActive} onChange={set("makeActive")} /> Use this key for new uploads
        </label>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button onClick={add} disabled={busy || !form.label || !form.keyId || !form.applicationKey || !form.bucketName}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "Saving…" : "Add key"}
        </button>
      </section>

      <section>
        <h2 className="font-medium mb-3">Keys</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="px-5 py-3 font-medium">Label</th>
                <th className="px-5 py-3 font-medium">Bucket</th>
                <th className="px-5 py-3 font-medium">Key ID</th>
                <th className="px-5 py-3 font-medium">State</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {keys.map((k) => (
                <tr key={k.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-3 font-medium text-slate-800">{k.label}</td>
                  <td className="px-5 py-3 text-slate-600">{k.bucket_name} <span className="text-slate-400">({k.region})</span></td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{k.key_id}</td>
                  <td className="px-5 py-3">
                    {k.status === "revoked"
                      ? <Pill tone="slate">revoked</Pill>
                      : k.is_active ? <Pill tone="emerald">active</Pill> : <Pill tone="amber">standby</Pill>}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {k.status === "active" && !k.is_active && <button onClick={() => activate(k.id)} className="mr-3 text-indigo-600 text-xs hover:underline">Make active</button>}
                    {k.status === "active" && <button onClick={() => revoke(k.id)} className="text-rose-600 text-xs hover:underline">Revoke</button>}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && <tr><td colSpan={5} className="px-5 py-10 text-center text-slate-400">No keys yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, v, on, type = "text", placeholder }: { label: string; v: string; on: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string; }) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input type={type} value={v} onChange={on} placeholder={placeholder} className={inputCls + " mt-1"} />
    </label>
  );
}
function Pill({ tone, children }: { tone: "emerald" | "amber" | "slate"; children: React.ReactNode }) {
  const c = { emerald: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", slate: "bg-slate-100 text-slate-500" }[tone];
  return <span className={`rounded-full px-2 py-0.5 text-xs ${c}`}>{children}</span>;
}
