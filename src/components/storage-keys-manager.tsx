"use client";
import { useEffect, useState } from "react";

interface KeyRow {
  id: string; provider: "backblaze" | "r2"; label: string; key_id: string; bucket_name: string;
  region: string; account_id: string | null; is_active: boolean; status: "active" | "revoked"; created_at: string;
}
const empty = {
  provider: "backblaze" as "backblaze" | "r2",
  label: "", keyId: "", applicationKey: "", bucketId: "", bucketName: "",
  region: "us-west-004", accountId: "", makeActive: true,
};
const inputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none";

export function StorageKeysManager() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corsMsg, setCorsMsg] = useState<string | null>(null);
  const [corsBusy, setCorsBusy] = useState(false);

  async function enableUploads() {
    setCorsBusy(true); setCorsMsg(null);
    const r = await fetch("/api/storage-keys/cors", { method: "POST" });
    const j = await r.json(); setCorsBusy(false);
    setCorsMsg(r.ok ? `✓ Browser uploads enabled for ${j.bucket}. Try uploading now.` : `✗ ${j.error}`);
  }

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
      <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-indigo-900">Enable browser uploads</h2>
            <p className="text-sm text-indigo-700/80 mt-1">
              Storage providers block uploads from a website until the bucket allows this site. Click once to set that up for your active key's bucket (works for both Backblaze and R2).
            </p>
          </div>
          <button onClick={enableUploads} disabled={corsBusy}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {corsBusy ? "Enabling…" : "Enable uploads"}
          </button>
        </div>
        {corsMsg && <p className={`mt-3 text-sm ${corsMsg.startsWith("✓") ? "text-emerald-700" : "text-rose-600"}`}>{corsMsg}</p>}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium">Add a storage key</h2>
        <p className="text-sm text-slate-500 mt-1">
          Use a key scoped to one bucket. The secret is encrypted before storage and never shown again.
        </p>

        <label className="mt-4 block text-sm max-w-xs">
          <span className="text-slate-600">Provider</span>
          <select
            value={form.provider}
            onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as "backblaze" | "r2" }))}
            className={inputCls + " mt-1"}
          >
            <option value="backblaze">Backblaze B2</option>
            <option value="r2">Cloudflare R2</option>
          </select>
        </label>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Label" v={form.label} on={set("label")} placeholder="e.g. Company bucket" />
          {form.provider === "backblaze" ? (
            <Field label="Region" v={form.region} on={set("region")} placeholder="us-west-004" />
          ) : (
            <Field label="Cloudflare Account ID" v={form.accountId} on={set("accountId")} placeholder="the <ACCOUNT_ID> in https://<ACCOUNT_ID>.r2.cloudflarestorage.com" />
          )}
          <Field label="Key ID" v={form.keyId} on={set("keyId")} placeholder={form.provider === "r2" ? "Access Key ID" : "applicationKeyId"} />
          <Field label="Application key (secret)" v={form.applicationKey} on={set("applicationKey")} type="password" placeholder={form.provider === "r2" ? "Secret Access Key" : undefined} />
          <Field label="Bucket name" v={form.bucketName} on={set("bucketName")} placeholder="my-bucket" />
          {form.provider === "backblaze" && (
            <Field label="Bucket ID (optional)" v={form.bucketId} on={set("bucketId")} placeholder="leave blank if unsure" />
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.makeActive} onChange={set("makeActive")} /> Use this key for new uploads
        </label>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        <button
          onClick={add}
          disabled={
            busy || !form.label || !form.keyId || !form.applicationKey || !form.bucketName ||
            (form.provider === "backblaze" ? !form.region : !form.accountId)
          }
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
                <th className="px-5 py-3 font-medium">Provider</th>
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
                  <td className="px-5 py-3 text-slate-600">{k.provider === "r2" ? "Cloudflare R2" : "Backblaze B2"}</td>
                  <td className="px-5 py-3 text-slate-600">
                    {k.bucket_name}{" "}
                    <span className="text-slate-400">
                      ({k.provider === "r2" ? k.account_id : k.region})
                    </span>
                  </td>
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
              {keys.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-400">No keys yet.</td></tr>}
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
