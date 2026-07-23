"use client";
import { useEffect, useState } from "react";

interface KeyRow {
  id: string;
  label: string;
  key_id: string;
  bucket_name: string;
  region: string;
  is_active: boolean;
  status: "active" | "revoked";
  created_at: string;
}

const empty = {
  label: "", keyId: "", applicationKey: "", bucketId: "",
  bucketName: "", region: "us-west-004", makeActive: true,
};

export function StorageKeysManager() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [form, setForm] = useState({ ...empty });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/storage-keys");
    const j = await r.json();
    if (r.ok) setKeys(j.keys);
    else setError(j.error);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    setBusy(true); setError(null);
    const r = await fetch("/api/storage-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error);
    setForm({ ...empty });
    load();
  }

  async function activate(id: string) {
    await fetch(`/api/storage-keys/${id}`, { method: "PATCH" });
    load();
  }
  async function revoke(id: string) {
    if (!confirm("Revoke this key? Files already stored with it stay downloadable, but no new uploads will use it.")) return;
    await fetch(`/api/storage-keys/${id}`, { method: "DELETE" });
    load();
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    }) as typeof form);

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-white p-5">
        <h2 className="font-medium">Add a Backblaze key</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Use a <strong>restricted</strong> key scoped to one bucket (read/write/delete/share). The secret is
          encrypted before it is stored and never shown again.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Label" v={form.label} on={set("label")} placeholder="Primary bucket" />
          <Field label="Region" v={form.region} on={set("region")} placeholder="us-west-004" />
          <Field label="Key ID (applicationKeyId)" v={form.keyId} on={set("keyId")} />
          <Field label="Application Key (secret)" v={form.applicationKey} on={set("applicationKey")} type="password" />
          <Field label="Bucket ID" v={form.bucketId} on={set("bucketId")} />
          <Field label="Bucket Name" v={form.bucketName} on={set("bucketName")} />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.makeActive} onChange={set("makeActive")} />
          Make this the active key for new uploads
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={add} disabled={busy}
          className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {busy ? "Saving…" : "Add key"}
        </button>
      </section>

      <section>
        <h2 className="font-medium">Existing keys</h2>
        <div className="mt-3 overflow-hidden rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-neutral-500">
              <tr>
                <th className="px-4 py-2">Label</th>
                <th className="px-4 py-2">Bucket</th>
                <th className="px-4 py-2">Key ID</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-t">
                  <td className="px-4 py-2">{k.label}</td>
                  <td className="px-4 py-2">{k.bucket_name} <span className="text-neutral-400">({k.region})</span></td>
                  <td className="px-4 py-2 font-mono text-xs">{k.key_id}</td>
                  <td className="px-4 py-2">
                    {k.status === "revoked" ? (
                      <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">revoked</span>
                    ) : k.is_active ? (
                      <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">active</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">standby</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {k.status === "active" && !k.is_active && (
                      <button onClick={() => activate(k.id)} className="mr-3 text-brand hover:underline">Activate</button>
                    )}
                    {k.status === "active" && (
                      <button onClick={() => revoke(k.id)} className="text-red-600 hover:underline">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
              {keys.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-400">No keys yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({
  label, v, on, type = "text", placeholder,
}: {
  label: string; v: string; on: (e: React.ChangeEvent<HTMLInputElement>) => void; type?: string; placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-600">{label}</span>
      <input
        type={type} value={v} onChange={on} placeholder={placeholder}
        className="mt-1 w-full rounded-md border px-3 py-2"
      />
    </label>
  );
}
