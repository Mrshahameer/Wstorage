"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Rel { name: string }
interface FileDetail {
  id: string; name: string; description: string | null; extension: string | null;
  content_type: string | null; size_bytes: number; tags: string[]; download_count: number;
  buyer: string | null; live_url: string | null; dev_url: string | null;
  created_at: string; current_version: number;
  folders: { name: string; path: string } | null;
  categories: Rel | null; verticals: Rel | null;
  campaigns: { name: string; buyer: string | null } | null;
  resource_types: { name: string; icon: string | null } | null;
  storage_keys: { provider: string; label: string; bucket_name: string } | null;
}
interface Version { version: number; size_bytes: number; notes: string | null; created_at: string }

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function kind(contentType: string | null, ext: string | null): "image" | "video" | "audio" | "pdf" | "other" {
  const c = (contentType || "").toLowerCase(); const e = (ext || "").toLowerCase();
  if (c.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "image";
  if (c.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(e)) return "video";
  if (c.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg"].includes(e)) return "audio";
  if (c === "application/pdf" || e === "pdf") return "pdf";
  return "other";
}

export function AssetDetail({ id, canShare }: { id: string; canShare: boolean }) {
  const [file, setFile] = useState<FileDetail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/files/${id}`);
    const j = await r.json();
    if (!r.ok) { setError(j.error || "Not available"); setLoading(false); return; }
    setFile(j.file); setVersions(j.versions ?? []);
    setLoading(false);
    // preview URL (inline; may fail if storage secret can't decrypt — non-fatal)
    const p = await fetch(`/api/files/${id}/preview`);
    if (p.ok) setPreviewUrl((await p.json()).url);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function createShareLink() {
    setError("");
    const res = await fetch("/api/share-links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file?.name, resources: [{ type: "file", id }] }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error || "Failed to create share link");
    setShareUrl(j.shareLink.url);
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error && !file) return (
    <div className="space-y-4">
      <Link href="/files" className="text-sm text-indigo-600 hover:underline">← Back to Campaign Library</Link>
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
    </div>
  );
  if (!file) return null;

  const k = kind(file.content_type, file.extension);
  const crumbs = [file.categories?.name, file.verticals?.name, file.campaigns?.name, file.folders?.name].filter(Boolean);

  return (
    <div className="max-w-4xl space-y-6">
      <Link href="/files" className="text-sm text-indigo-600 hover:underline">← Back to Campaign Library</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{file.name}</h1>
        {crumbs.length > 0 && <p className="text-sm text-slate-500 mt-1">{crumbs.join("  ›  ")}</p>}
      </div>

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>}

      {/* Preview */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="bg-slate-50 grid place-items-center p-4 min-h-[220px]">
          {!previewUrl ? (
            <div className="text-center text-sm text-slate-400">
              <div className="text-4xl">📦</div>
              <p className="mt-2">Preview unavailable{k === "other" ? " for this file type" : ""}. Use Download below.</p>
            </div>
          ) : k === "image" ? (
            <img src={previewUrl} alt={file.name} className="max-h-[480px] max-w-full rounded" />
          ) : k === "video" ? (
            <video src={previewUrl} controls className="max-h-[480px] max-w-full rounded" />
          ) : k === "audio" ? (
            <audio src={previewUrl} controls className="w-full" />
          ) : k === "pdf" ? (
            <iframe src={previewUrl} className="w-full h-[520px] rounded border-0" title={file.name} />
          ) : (
            <a href={previewUrl} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">Open file in new tab</a>
          )}
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 p-4">
          <a href={`/api/download/${file.id}`} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Download</a>
          {file.live_url && <a href={file.live_url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Open landing page</a>}
          <button
            onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/files/${file.id}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            {copied ? "Copied!" : "Copy link"}
          </button>
          {canShare && <button onClick={createShareLink} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Create share link</button>}
        </div>
        {shareUrl && (
          <div className="border-t border-slate-100 p-4">
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm flex items-center gap-2">
              <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs">{shareUrl}</code>
              <button className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy</button>
            </div>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-2 text-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-2">Details</h2>
          {file.resource_types?.name && <Row label="Resource type" value={file.resource_types.name} />}
          {file.categories?.name && <Row label="Category" value={file.categories.name} />}
          {file.verticals?.name && <Row label="Vertical" value={file.verticals.name} />}
          {file.campaigns?.name && <Row label="Campaign" value={file.campaigns.name + (file.campaigns.buyer ? ` · ${file.campaigns.buyer}` : "")} />}
          {file.buyer && <Row label="Buyer" value={file.buyer} />}
          <Row label="Size" value={fmtBytes(file.size_bytes)} />
          <Row label="Type" value={file.content_type || file.extension || "—"} />
          <Row label="Version" value={String(file.current_version)} />
          <Row label="Downloads" value={String(file.download_count)} />
          <Row label="Added" value={new Date(file.created_at).toLocaleString()} />
          {file.storage_keys && <Row label="Storage" value={`${file.storage_keys.provider === "r2" ? "Cloudflare R2" : "Backblaze B2"} · ${file.storage_keys.bucket_name}`} />}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-2">Description & tags</h2>
          <p className="text-slate-600">{file.description || <span className="text-slate-400">No description.</span>}</p>
          {file.tags?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {file.tags.map((t) => <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-600">#{t}</span>)}
            </div>
          )}
          {versions.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Versions</h3>
              <ul className="text-xs text-slate-600 space-y-1">
                {versions.map((v) => (
                  <li key={v.version} className="flex justify-between">
                    <span>v{v.version} {v.notes ? `— ${v.notes}` : ""}</span>
                    <span className="text-slate-400">{new Date(v.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 text-right">{value}</span>
    </div>
  );
}
