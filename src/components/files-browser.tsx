"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "./upload-panel";

interface FileRow {
  id: string; name: string; description: string | null; extension: string | null;
  size_bytes: number; download_count: number; created_at: string; tags: string[];
  storage_keys?: { provider: string; label: string; bucket_name: string } | null;
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

type Opt = { id: string; name: string };

export function FilesBrowser({ canUpload }: { canUpload: boolean }) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  // Filters
  const [categories, setCategories] = useState<Opt[]>([]);
  const [verticals, setVerticals] = useState<Opt[]>([]);
  const [resourceTypes, setResourceTypes] = useState<Opt[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [verticalId, setVerticalId] = useState("");
  const [resourceTypeId, setResourceTypeId] = useState("");
  const [ext, setExt] = useState("");

  useEffect(() => {
    const j = (u: string) => fetch(u).then((r) => r.json());
    j("/api/categories").then((d) => setCategories(d.categories ?? [])).catch(() => {});
    j("/api/verticals").then((d) => setVerticals(d.verticals ?? [])).catch(() => {});
    j("/api/resource-types").then((d) => setResourceTypes(d.resourceTypes ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (categoryId) p.set("categoryId", categoryId);
      if (verticalId) p.set("verticalId", verticalId);
      if (resourceTypeId) p.set("resourceTypeId", resourceTypeId);
      if (ext) p.set("ext", ext);
      const r = await fetch(`/api/files?${p.toString()}`);
      const j = await r.json();
      if (r.ok) setFiles(j.files);
    } finally { setLoading(false); }
  }, [q, categoryId, verticalId, resourceTypeId, ext]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const clearFilters = () => { setCategoryId(""); setVerticalId(""); setResourceTypeId(""); setExt(""); };
  const hasFilters = categoryId || verticalId || resourceTypeId || ext;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
          <p className="text-sm text-slate-500 mt-1">Find any campaign asset by name, tag, vertical, or resource type.</p>
        </div>
        {canUpload && (
          <button onClick={() => setShowUpload(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition">
            Upload files
          </button>
        )}
      </div>

      <div className="mt-6">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, description, or tag…"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(() => { const s = "rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500 bg-white"; return (<>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={s}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={verticalId} onChange={(e) => setVerticalId(e.target.value)} className={s}>
            <option value="">All verticals</option>
            {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={resourceTypeId} onChange={(e) => setResourceTypeId(e.target.value)} className={s}>
            <option value="">All resource types</option>
            {resourceTypes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input value={ext} onChange={(e) => setExt(e.target.value)} placeholder="File type (mp4, pdf…)" className={s + " w-36"} />
          {hasFilters && <button onClick={clearFilters} className="text-xs text-indigo-600 hover:underline">Clear filters</button>}
        </>); })()}
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
                      <div className="flex items-center gap-2">
                        <Link href={`/files/${f.id}`} className="font-medium text-slate-800 truncate hover:text-indigo-600 hover:underline">{f.name}</Link>
                        {f.storage_keys && (
                          <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${
                            f.storage_keys.provider === "r2"
                              ? "bg-sky-50 text-sky-700 border border-sky-200"
                              : "bg-amber-50 text-amber-800 border border-amber-200"
                          }`}>
                            {f.storage_keys.provider === "r2" ? "☁️ Cloudflare R2" : "📦 Backblaze B2"}
                          </span>
                        )}
                      </div>
                      {f.description && <div className="text-xs text-slate-400 truncate">{f.description}</div>}
                      {f.tags && f.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {f.tags.map((t) => (
                            <button
                              key={t}
                              onClick={() => setQ(t)}
                              className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100 transition"
                            >
                              #{t}
                            </button>
                          ))}
                        </div>
                      )}
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
