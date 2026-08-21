"use client";
import { useCallback, useEffect, useState } from "react";

interface ShareLink {
  id: string;
  token: string;
  name: string | null;
  allow_download: boolean;
  expires_at: string | null;
  max_downloads: number | null;
  current_downloads: number;
  status: "active" | "disabled";
  created_at: string;
}
interface Folder { id: string; name: string; path: string }
interface Campaign { id: string; name: string; buyer: string | null }
interface Vertical { id: string; name: string }

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4";
const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const btn = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";

export default function ShareLinksPage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  // form
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"folder" | "campaign">("folder");
  const [folderId, setFolderId] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");

  const j = async (u: string) => (await fetch(u)).json();
  const load = useCallback(async () => {
    const [l, f, v] = await Promise.all([j("/api/share-links"), j("/api/folders"), j("/api/verticals")]);
    setLinks(l.shareLinks ?? []);
    setFolders(f.folders ?? []);
    setVerticals(v.verticals ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!verticalId) return setCampaigns([]);
    j(`/api/campaigns?verticalId=${verticalId}`).then((c) => setCampaigns(c.campaigns ?? []));
    setCampaignId("");
  }, [verticalId]);

  async function create() {
    setError("");
    setCreated(null);
    const resource = kind === "folder" ? { type: "folder", id: folderId } : { type: "campaign", id: campaignId };
    if (!resource.id) return setError("Pick a resource to share.");
    const res = await fetch("/api/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        resources: [resource],
        password: password || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        maxDownloads: maxDownloads ? Number(maxDownloads) : undefined,
      }),
    });
    const json = await res.json();
    if (!res.ok) return setError(json.error || "Failed to create link");
    setCreated(json.shareLink.url);
    setName(""); setPassword(""); setExpiresAt(""); setMaxDownloads("");
    load();
  }

  async function setStatus(id: string, status: "active" | "disabled") {
    await fetch(`/api/share-links/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  }
  async function remove(id: string) {
    if (!confirm("Delete this share link permanently?")) return;
    await fetch(`/api/share-links/${id}`, { method: "DELETE" });
    load();
  }
  const shareUrl = (t: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/share/${t}`;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Share links</h1>
        <p className="text-sm text-slate-500 mt-1">Send buyers a secure link — no account needed. Set a password, expiry, and download cap.</p>
      </div>
      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>}

      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">Create a share link</h2>
        <input className={`${input} w-full`} placeholder="Link name (e.g. Auto Insurance Inbound Package)" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2 text-sm">
          <button onClick={() => setKind("folder")} className={`rounded-lg px-3 py-1.5 ${kind === "folder" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>Share a folder</button>
          <button onClick={() => setKind("campaign")} className={`rounded-lg px-3 py-1.5 ${kind === "campaign" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>Share a campaign</button>
        </div>

        {kind === "folder" ? (
          <select className={`${input} w-full`} value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Select a folder…</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.path || f.name}</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className={input} value={verticalId} onChange={(e) => setVerticalId(e.target.value)}>
              <option value="">Select a vertical…</option>
              {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <select className={input} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!verticalId}>
              <option value="">{verticalId ? "Select a campaign…" : "Pick a vertical first"}</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.buyer ? ` · ${c.buyer}` : ""}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input className={input} type="password" placeholder="Password (optional)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input className={input} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          <input className={input} type="number" min={1} placeholder="Max downloads (optional)" value={maxDownloads} onChange={(e) => setMaxDownloads(e.target.value)} />
        </div>
        <button className={btn} onClick={create}>Create link</button>

        {created && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm">
            <p className="text-emerald-800 font-medium">Link created</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{created}</code>
              <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white" onClick={() => navigator.clipboard.writeText(created)}>Copy</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/50">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Downloads</th>
              <th className="px-5 py-3 font-medium">Expires</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {links.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No share links yet.</td></tr>
            ) : links.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/50">
                <td className="px-5 py-3">
                  <div className="font-medium text-slate-800">{l.name || "Untitled"}</div>
                  <button className="text-xs text-indigo-600 hover:underline" onClick={() => navigator.clipboard.writeText(shareUrl(l.token))}>Copy link</button>
                </td>
                <td className="px-5 py-3 text-slate-600">{l.current_downloads}{l.max_downloads != null ? ` / ${l.max_downloads}` : ""}</td>
                <td className="px-5 py-3 text-slate-500">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "Never"}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${l.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>{l.status}</span>
                </td>
                <td className="px-5 py-3 text-right space-x-2">
                  {l.status === "active"
                    ? <button className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => setStatus(l.id, "disabled")}>Disable</button>
                    : <button className="rounded border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100" onClick={() => setStatus(l.id, "active")}>Enable</button>}
                  <button className="rounded border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100" onClick={() => remove(l.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
