"use client";
import { useEffect, useState } from "react";

interface Log {
  id: number; actor_email: string | null; action: string;
  target_type: string | null; detail: Record<string, unknown>; created_at: string;
}

const actionColor = (a: string) => {
  if (a.includes("delete") || a.includes("revoke") || a.includes("reject")) return "bg-rose-100 text-rose-700";
  if (a.includes("create") || a.includes("upload") || a.includes("approve")) return "bg-emerald-100 text-emerald-700";
  if (a.includes("download")) return "bg-indigo-100 text-indigo-700";
  if (a.includes("share")) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
};

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch("/api/activity?limit=200").then((r) => r.json()).then((j) => setLogs(j.logs ?? [])).finally(() => setLoading(false));
  }, []);

  const filtered = logs.filter((l) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (l.actor_email || "").toLowerCase().includes(s) || l.action.toLowerCase().includes(s) ||
      JSON.stringify(l.detail || {}).toLowerCase().includes(s);
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity logs</h1>
        <p className="text-sm text-slate-500 mt-1">Every upload, download, share, and admin action, newest first.</p>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by user, action, or asset…"
        className="w-full max-w-md rounded-lg border border-slate-300 px-3.5 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100 bg-slate-50/50">
              <th className="px-5 py-3 font-medium">Who</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Target</th>
              <th className="px-5 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-slate-400">No activity.</td></tr>
            ) : filtered.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50/70">
                <td className="px-5 py-3 text-slate-700">{l.actor_email || <span className="text-slate-400">system</span>}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${actionColor(l.action)}`}>{l.action.replace(/_/g, " ")}</span>
                </td>
                <td className="px-5 py-3 text-slate-600">
                  {(l.detail?.name as string) || (l.detail?.email as string) || l.target_type || "—"}
                </td>
                <td className="px-5 py-3 text-slate-400 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
