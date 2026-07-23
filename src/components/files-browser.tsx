"use client";
import { useCallback, useEffect, useState } from "react";
import { UploadDropzone } from "./upload-dropzone";

interface FileRow {
  id: string; name: string; extension: string | null;
  size_bytes: number; download_count: number; created_at: string;
}

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

export function FilesBrowser({ canUpload }: { canUpload: boolean }) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/files?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (r.ok) setFiles(j.files);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce search
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search files…"
          className="w-full max-w-sm rounded-md border px-3 py-2 text-sm"
        />
        {canUpload && (
          <button
            onClick={() => setShowUpload((s) => !s)}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
          >
            {showUpload ? "Close" : "Upload"}
          </button>
        )}
      </div>

      {showUpload && (
        <div className="mt-4">
          <UploadDropzone onDone={load} />
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Size</th>
              <th className="px-4 py-2">Downloads</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-t">
                <td className="px-4 py-2">{f.name}</td>
                <td className="px-4 py-2">{fmtBytes(Number(f.size_bytes))}</td>
                <td className="px-4 py-2">{f.download_count}</td>
                <td className="px-4 py-2 text-right">
                  {/* Hits the authenticated endpoint, which redirects to a short-lived signed URL */}
                  <a href={`/api/download/${f.id}`} className="text-brand hover:underline">Download</a>
                </td>
              </tr>
            ))}
            {files.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-neutral-400">No files.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
