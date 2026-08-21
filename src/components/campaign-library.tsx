"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Sel = { id: string; name: string } | null;
interface Row { id: string; name: string; buyer?: string | null }
interface FileRow { id: string; name: string; extension: string | null; size_bytes: number; download_count: number; resource_types?: { name: string } | null }

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function iconFor(ext: string | null) {
  const e = (ext || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "🖼️";
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(e)) return "🎬";
  if (["mp3", "wav", "m4a", "ogg"].includes(e)) return "🎧";
  if (["pdf"].includes(e)) return "📄";
  if (["zip", "rar", "7z"].includes(e)) return "🗜️";
  if (["xls", "xlsx", "csv"].includes(e)) return "📊";
  return "📁";
}

const Card = ({ title, subtitle, emoji, onClick }: { title: string; subtitle?: string; emoji: string; onClick: () => void }) => (
  <button onClick={onClick} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-lg group-hover:bg-indigo-100">{emoji}</span>
    <span className="min-w-0">
      <span className="block truncate font-medium text-slate-800">{title}</span>
      {subtitle && <span className="block truncate text-xs text-slate-400">{subtitle}</span>}
    </span>
  </button>
);

export function CampaignLibrary() {
  const [cat, setCat] = useState<Sel>(null);
  const [vert, setVert] = useState<Sel>(null);
  const [camp, setCamp] = useState<Sel>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);

  const j = async (u: string) => (await fetch(u)).json();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!cat) { const d = await j("/api/categories"); setRows(d.categories ?? []); }
      else if (!vert) { const d = await j(`/api/verticals?categoryId=${cat.id}`); setRows(d.verticals ?? []); }
      else if (!camp) { const d = await j(`/api/campaigns?verticalId=${vert.id}`); setRows(d.campaigns ?? []); }
      else { const d = await j(`/api/files?campaignId=${camp.id}`); setFiles(d.files ?? []); }
    } finally { setLoading(false); }
  }, [cat, vert, camp]);
  useEffect(() => { load(); }, [load]);

  const level = !cat ? "category" : !vert ? "vertical" : !camp ? "campaign" : "assets";

  const crumb = (label: string, onClick?: () => void) =>
    onClick ? <button onClick={onClick} className="text-indigo-600 hover:underline">{label}</button> : <span className="text-slate-700">{label}</span>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaign Library</h1>
        <p className="text-sm text-slate-500 mt-1">Browse by Category › Vertical › Campaign, then open the assets.</p>
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {crumb("All", cat ? () => { setCat(null); setVert(null); setCamp(null); } : undefined)}
        {cat && <><span className="text-slate-300">›</span>{crumb(cat.name, vert ? () => { setVert(null); setCamp(null); } : undefined)}</>}
        {vert && <><span className="text-slate-300">›</span>{crumb(vert.name, camp ? () => setCamp(null) : undefined)}</>}
        {camp && <><span className="text-slate-300">›</span>{crumb(camp.name)}</>}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : level === "assets" ? (
        files.length === 0 ? (
          <p className="text-sm text-slate-400">No assets in this campaign yet.</p>
        ) : (
          <div className="space-y-4">
            {/* Resource-type summary (blueprint §12) */}
            <div className="flex flex-wrap gap-2">
              <span className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">{files.length} assets</span>
              {Object.entries(files.reduce((acc: Record<string, number>, f) => {
                const k = f.resource_types?.name || "Other"; acc[k] = (acc[k] || 0) + 1; return acc;
              }, {})).sort((a, b) => b[1] - a[1]).map(([name, n]) => (
                <span key={name} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">{name} · {n}</span>
              ))}
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-50">
              {files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-slate-50/70">
                  <Link href={`/files/${f.id}`} className="flex min-w-0 items-center gap-3">
                    <span className="text-lg">{iconFor(f.extension)}</span>
                    <span className="truncate font-medium text-slate-800 hover:text-indigo-600">{f.name}</span>
                  </Link>
                  <div className="flex shrink-0 items-center gap-4 text-xs text-slate-400">
                    <span>{fmtBytes(f.size_bytes)}</span>
                    <a href={`/api/download/${f.id}`} className="rounded-md border border-slate-200 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">Download</a>
                  </div>
                </li>
              ))}
            </ul>
            </div>
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          {level === "category" ? "No categories yet — create them in Campaign management." : `No ${level}s here yet.`}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <Card
              key={r.id}
              title={r.name}
              subtitle={level === "campaign" && r.buyer ? r.buyer : undefined}
              emoji={level === "category" ? "🗂️" : level === "vertical" ? "🎯" : "📣"}
              onClick={() => {
                if (level === "category") setCat({ id: r.id, name: r.name });
                else if (level === "vertical") setVert({ id: r.id, name: r.name });
                else setCamp({ id: r.id, name: r.name });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
