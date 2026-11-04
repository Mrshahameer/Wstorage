"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";

interface ShareFile {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string | null;
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  folder: string | null;
}
interface ShareData {
  name: string | null;
  allowDownload: boolean;
  allowPreview: boolean;
  files: ShareFile[];
}

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
function iconFor(name: string, ct: string | null): string {
  const e = (name.split(".").pop() || "").toLowerCase();
  const c = (ct || "").toLowerCase();
  if (c.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(e)) return "🖼️";
  if (c.startsWith("video/") || ["mp4", "mov", "webm", "mkv"].includes(e)) return "🎬";
  if (c.startsWith("audio/") || ["mp3", "wav", "m4a", "ogg"].includes(e)) return "🎧";
  if (e === "pdf" || c === "application/pdf") return "📄";
  if (["zip", "rar", "7z"].includes(e)) return "🗜️";
  if (["xls", "xlsx", "csv"].includes(e)) return "📊";
  if (["doc", "docx"].includes(e)) return "📝";
  return "📁";
}

interface Group {
  key: string;
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  folders: { folder: string | null; files: ShareFile[] }[];
  count: number;
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<ShareData | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (pw?: string) => {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/share/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const json = await res.json();
      setLoading(false);
      if (res.status === 401 && json.requiresPassword) {
        setNeedsPassword(true);
        if (json.error) setError(json.error);
        return;
      }
      if (!res.ok) {
        setError(json.error || "Unable to open this link.");
        return;
      }
      setNeedsPassword(false);
      setData(json);
    },
    [token]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Group files: Category › Vertical › Campaign, then by folder inside each.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const f of data?.files ?? []) {
      const key = `${f.category ?? ""}|${f.vertical ?? ""}|${f.campaign ?? ""}`;
      let g = map.get(key);
      if (!g) {
        g = { key, category: f.category, vertical: f.vertical, campaign: f.campaign, folders: [], count: 0 };
        map.set(key, g);
      }
      let fg = g.folders.find((x) => x.folder === (f.folder ?? null));
      if (!fg) { fg = { folder: f.folder ?? null, files: [] }; g.folders.push(fg); }
      fg.files.push(f);
      g.count++;
    }
    return Array.from(map.values());
  }, [data]);

  const toggle = (k: string) =>
    setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  async function download(file: ShareFile) {
    setBusyId(file.id);
    try {
      const res = await fetch(`/api/share/${token}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id, password: password || undefined }),
      });
      const json = await res.json();
      if (!res.ok) return alert(json.error || "Download failed.");
      window.location.href = json.url;
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="mx-auto max-w-2xl p-6">
        <div className="mb-6 flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-sm font-bold text-white">W</div>
          <span className="font-semibold">Wstorage</span>
        </div>

        {loading && <p className="text-sm text-neutral-500">Loading…</p>}

        {!loading && needsPassword && (
          <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
            <h1 className="text-lg font-semibold">Password required</h1>
            <p className="mt-1 text-sm text-neutral-500">This shared link is password protected.</p>
            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && load(password)}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                onClick={() => load(password)}
                className="w-full rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark"
              >
                Unlock
              </button>
            </div>
          </div>
        )}

        {!loading && !needsPassword && error && (
          <div className="rounded-xl border bg-white p-6 text-sm text-red-600 shadow-sm">{error}</div>
        )}

        {!loading && data && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h1 className="text-lg font-semibold">{data.name || "Shared resources"}</h1>
              <p className="mt-1 text-sm text-neutral-500">
                {data.files.length} file{data.files.length === 1 ? "" : "s"} shared with you
                {groups.length > 1 ? ` · ${groups.length} campaigns` : ""}
              </p>
            </div>

            {groups.map((g) => {
              const path = [g.category, g.vertical, g.campaign].filter(Boolean).join("  ›  ");
              const isCollapsed = collapsed.has(g.key);
              return (
                <div key={g.key} className="overflow-hidden rounded-xl border bg-white shadow-sm">
                  <button
                    onClick={() => toggle(g.key)}
                    className="flex w-full items-center justify-between gap-3 border-b bg-neutral-50/60 px-5 py-3 text-left hover:bg-neutral-100/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-neutral-800">{g.campaign || "Files"}</p>
                      {path && <p className="truncate text-xs text-neutral-400">{path}</p>}
                    </div>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-400">
                      <span>{g.count}</span>
                      <span className={"transition " + (isCollapsed ? "" : "rotate-90")}>▸</span>
                    </span>
                  </button>

                  {!isCollapsed && (
                    <div>
                      {g.folders.map((fg) => (
                        <div key={fg.folder ?? "_"}>
                          {fg.folder && (
                            <p className="bg-white px-5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                              {fg.folder}
                            </p>
                          )}
                          <ul className="divide-y">
                            {fg.files.map((f) => (
                              <li key={f.id} className="flex items-center justify-between gap-4 px-5 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="text-lg">{iconFor(f.name, f.content_type)}</span>
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-neutral-800">{f.name}</p>
                                    <p className="text-xs text-neutral-400">{fmtSize(f.size_bytes)}</p>
                                  </div>
                                </div>
                                {data.allowDownload && (
                                  <button
                                    onClick={() => download(f)}
                                    disabled={busyId === f.id}
                                    className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
                                  >
                                    {busyId === f.id ? "…" : "Download"}
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {data.files.length === 0 && (
              <div className="rounded-xl border bg-white p-4 text-sm text-neutral-500 shadow-sm">
                No files are available in this link.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
