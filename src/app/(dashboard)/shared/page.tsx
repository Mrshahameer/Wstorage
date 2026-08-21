"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

interface FileRow { id: string; name: string; extension: string | null; created_at: string; folder_id: string | null }

function iconFor(ext: string | null) {
  const e = (ext || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "🖼️";
  if (["mp4", "mov", "webm", "mkv"].includes(e)) return "🎬";
  if (["mp3", "wav", "m4a"].includes(e)) return "🎧";
  if (["pdf"].includes(e)) return "📄";
  if (["zip", "rar"].includes(e)) return "🗜️";
  return "📁";
}

export default function SharedPage() {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Files the API returns are already access-filtered to what this user may see.
    // "Shared with me" surfaces the resources granted to a user (excludes the
    // unfoldered shared pool so it reads as things specifically shared).
    fetch("/api/files?pageSize=100").then((r) => r.json()).then((j) => setFiles(j.files ?? [])).finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shared with me</h1>
        <p className="text-sm text-slate-500 mt-1">Campaign resources you have access to.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          Nothing has been shared with you yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ul className="divide-y divide-slate-50">
            {files.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50/70">
                <Link href={`/files/${f.id}`} className="flex min-w-0 items-center gap-3">
                  <span className="text-lg">{iconFor(f.extension)}</span>
                  <span className="truncate font-medium text-slate-800 hover:text-indigo-600">{f.name}</span>
                </Link>
                <div className="flex shrink-0 items-center gap-4 text-xs text-slate-400">
                  <span>{new Date(f.created_at).toLocaleDateString()}</span>
                  <a href={`/api/download/${f.id}`} className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">Download</a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
