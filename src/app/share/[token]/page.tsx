"use client";
import { use, useCallback, useEffect, useState } from "react";

interface ShareFile {
  id: string;
  name: string;
  size_bytes: number;
  content_type: string | null;
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

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<ShareData | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  async function download(file: ShareFile) {
    const res = await fetch(`/api/share/${token}/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId: file.id, password: password || undefined }),
    });
    const json = await res.json();
    if (!res.ok) return alert(json.error || "Download failed.");
    window.location.href = json.url;
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
          <div className="rounded-xl border bg-white shadow-sm">
            <div className="border-b p-5">
              <h1 className="text-lg font-semibold">{data.name || "Shared resources"}</h1>
              <p className="mt-1 text-sm text-neutral-500">
                {data.files.length} file{data.files.length === 1 ? "" : "s"} shared with you
              </p>
            </div>
            <ul className="divide-y">
              {data.files.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className="text-xs text-neutral-400">{fmtSize(f.size_bytes)}</p>
                  </div>
                  {data.allowDownload && (
                    <button
                      onClick={() => download(f)}
                      className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                    >
                      Download
                    </button>
                  )}
                </li>
              ))}
              {data.files.length === 0 && (
                <li className="p-4 text-sm text-neutral-500">No files are available in this link.</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
