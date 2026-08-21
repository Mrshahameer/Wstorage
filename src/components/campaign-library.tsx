"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { UploadPanel } from "./upload-panel";

type Sel = { id: string; name: string };
interface Row { id: string; name: string; buyer?: string | null }
interface FolderRow { id: string; name: string }
interface FileRow { id: string; name: string; extension: string | null; size_bytes: number; download_count: number }

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
const folderEmoji = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("creative")) return "🎨";
  if (n.includes("landing")) return "🌐";
  if (n.includes("ad copy")) return "✍️";
  if (n.includes("recording")) return "🎧";
  if (n.includes("script")) return "📜";
  if (n.includes("proof") || n.includes("screenshot")) return "📊";
  if (n.includes("sample") || n.includes("data")) return "🧾";
  if (n.includes("compliance") || n.includes("tcpa")) return "🛡️";
  return "📁";
};

const Card = ({ title, subtitle, emoji, onClick }: { title: string; subtitle?: string; emoji: string; onClick: () => void }) => (
  <button onClick={onClick} className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-lg group-hover:bg-indigo-100">{emoji}</span>
    <span className="min-w-0">
      <span className="block truncate font-medium text-slate-800">{title}</span>
      {subtitle && <span className="block truncate text-xs text-slate-400">{subtitle}</span>}
    </span>
  </button>
);

export function CampaignLibrary({ canUpload }: { canUpload: boolean }) {
  const [cat, setCat] = useState<Sel | null>(null);
  const [vert, setVert] = useState<Sel | null>(null);
  const [camp, setCamp] = useState<Sel | null>(null);
  const [stack, setStack] = useState<Sel[]>([]); // nested resource folders
  const [rows, setRows] = useState<Row[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);

  const j = async (u: string) => (await fetch(u)).json();
  const current = stack.length ? stack[stack.length - 1] : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!cat) { setRows((await j("/api/categories")).categories ?? []); }
      else if (!vert) { setRows((await j(`/api/verticals?categoryId=${cat.id}`)).verticals ?? []); }
      else if (!camp) { setRows((await j(`/api/campaigns?verticalId=${vert.id}`)).campaigns ?? []); }
      else if (stack.length === 0) { setFolders((await j(`/api/folders?campaignId=${camp.id}`)).folders ?? []); setFiles([]); }
      else {
        const cur = stack[stack.length - 1];
        const [f, fi] = await Promise.all([j(`/api/folders?parentId=${cur.id}`), j(`/api/files?folderId=${cur.id}`)]);
        setFolders(f.folders ?? []);
        setFiles(fi.files ?? []);
      }
    } finally { setLoading(false); }
  }, [cat, vert, camp, stack]);
  useEffect(() => { load(); }, [load]);

  const level = !cat ? "category" : !vert ? "vertical" : !camp ? "campaign" : "folders";
  const inFolder = !!camp && stack.length > 0;

  const resetTo = (target: "all" | "cat" | "vert" | "camp") => {
    if (target === "all") { setCat(null); setVert(null); setCamp(null); setStack([]); }
    if (target === "cat") { setVert(null); setCamp(null); setStack([]); }
    if (target === "vert") { setCamp(null); setStack([]); }
    if (target === "camp") { setStack([]); }
  };
  const crumbBtn = (label: string, onClick?: () => void) =>
    onClick ? <button onClick={onClick} className="text-indigo-600 hover:underline">{label}</button> : <span className="text-slate-700">{label}</span>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaign Library</h1>
          <p className="text-sm text-slate-500 mt-1">Category › Vertical › Campaign › Folder, then the assets.</p>
        </div>
        {inFolder && canUpload && (
          <button onClick={() => setShowUpload(true)} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            Upload files
          </button>
        )}
      </div>

      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {crumbBtn("All", cat ? () => resetTo("all") : undefined)}
        {cat && <><span className="text-slate-300">›</span>{crumbBtn(cat.name, vert ? () => resetTo("cat") : undefined)}</>}
        {vert && <><span className="text-slate-300">›</span>{crumbBtn(vert.name, camp ? () => resetTo("vert") : undefined)}</>}
        {camp && <><span className="text-slate-300">›</span>{crumbBtn(camp.name, stack.length ? () => resetTo("camp") : undefined)}</>}
        {stack.map((s, i) => (
          <span key={s.id} className="flex items-center gap-2">
            <span className="text-slate-300">›</span>
            {crumbBtn(s.name, i < stack.length - 1 ? () => setStack(stack.slice(0, i + 1)) : undefined)}
          </span>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : level === "folders" ? (
        <div className="space-y-4">
          {folders.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((f) => (
                <Card key={f.id} title={f.name} emoji={folderEmoji(f.name)} onClick={() => setStack([...stack, { id: f.id, name: f.name }])} />
              ))}
            </div>
          )}
          {inFolder && (
            files.length > 0 ? (
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
            ) : folders.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
                This folder is empty.{canUpload && " Use “Upload files” above."}
              </div>
            ) : null
          )}
          {!inFolder && folders.length === 0 && <p className="text-sm text-slate-400">No folders in this campaign yet.</p>}
        </div>
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

      {showUpload && current && canUpload && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={() => setShowUpload(false)}>
          <div className="mt-16 w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-base font-semibold">Upload files</h2>
              <button onClick={() => setShowUpload(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
            </div>
            <div className="p-6">
              <UploadPanel
                preset={{
                  folderId: current.id,
                  campaignId: camp?.id ?? null,
                  verticalId: vert?.id ?? null,
                  destinationLabel: [vert?.name, camp?.name, ...stack.map((s) => s.name)].filter(Boolean).join(" › "),
                }}
                onDone={load}
              />
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
