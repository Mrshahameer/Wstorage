"use client";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "./upload-panel";

interface FileRow {
  id: string; name: string; description: string | null; extension: string | null;
  size_bytes: number; download_count: number; created_at: string; tags: string[];
}

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function iconFor(ext: string | null) {
  const e = (ext || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "🖼️";
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(e)) return "🎬";
  if (["pdf"].includes(e)) return "📄";
  if (["zip", "rar", "7z", "tar", "gz"].includes(e)) return "🗜️";
  if (["doc", "docx", "txt", "md"].includes(e)) return "📝";
  if (["xls", "xlsx", "csv"].includes(e)) return "📊";
  return "📁";
}

export function FilesBrowser({ canUpload }: { canUpload: boolean }) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/files?q=${encodeURIComponent(q)}`);
      const j = await r.json();
      if (r.ok) setFiles(j.files);
    } finally { setLoading(false); }
  }, [q]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Files</h1>
          <p className="text-sm text-slate-500 mt-1">Search, preview, and download company assets.</p>
        </div>
        {canUpload && (
          <button onClick={() => setShowUpload(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition">
            Upload files
          </button>
        )}
      </div>

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Size</th>
              <th className="px-5 py-3 font-medium">Downloads</th>
              <th className="px-5 py-3 font-medium">Added</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400">Loading…</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center">
                <div className="text-slate-500 font-medium">No files yet</div>
                <div className="text-slate-400 text-xs mt-1">{canUpload ? "Upload your first file to get started." : "Files shared with you will appear here."}</div>
              </td></tr>
            ) : files.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50/70">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg leading-none">{iconFor(f.extension)}</span>
                    <div className="min-w-0">
                      <div className="font-medium text-slate-800 truncate">{f.name}</div>
                      {f.description && <div className="text-xs text-slate-400 truncate">{f.description}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{fmtBytes(Number(f.size_bytes))}</td>
                <td className="px-5 py-3 text-slate-600">{f.download_count}</td>
                <td className="px-5 py-3 text-slate-500 whitespace-nowrap">{new Date(f.created_at).toLocaleDateString()}</td>
                <td className="px-5 py-3 text-right space-x-2">
                  <a href={`/api/download/${f.id}`}
                    className="inline-flex items-center rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition">
                    Download
                  </a>
                  {canUpload && (
                    <button
                      onClick={async () => {
                        if (!confirm(`Are you sure you want to delete "${f.name}"?`)) return;
                        const res = await fetch(`/api/files/${f.id}`, { method: "DELETE" });
                        if (res.ok) {
                          load();
                        } else {
                          const j = await res.json();
                          alert(j.error || "Failed to delete file");
                        }
                      }}
                      className="inline-flex items-center rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100 transition">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setShowUpload(false)}>
          <div className="mt-16 w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold">Upload files</h2>
              <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="p-6">
              <UploadPanel onDone={load} />
            </div>
            <div className="px-6 py-3 border-t border-slate-100 text-right">
              <button onClick={() => setShowUpload(false)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
