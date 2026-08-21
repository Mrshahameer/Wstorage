"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

interface Analytics {
  totals: { assets: number; users: number; campaigns: number; activeShareLinks: number; storageBytes: number };
  recentUploads: { id: string; name: string; created_at: string }[];
  mostDownloaded: { id: string; name: string; download_count: number }[];
  mostActiveUsers: { email: string; downloads: number }[];
  recentShareLinks: { id: string; name: string | null; token: string; current_downloads: number; status: string }[];
}
interface FileRow { id: string; name: string; created_at: string; download_count: number }

const panel = "rounded-xl border border-slate-200 bg-white";

export function DashboardHome({ isAdmin, email }: { isAdmin: boolean; email: string }) {
  const [a, setA] = useState<Analytics | null>(null);
  const [recent, setRecent] = useState<FileRow[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (isAdmin) fetch("/api/analytics").then((r) => r.json()).then(setA).catch(() => {});
    fetch("/api/files?pageSize=8").then((r) => r.json()).then((j) => setRecent(j.files ?? [])).catch(() => {});
  }, [isAdmin]);

  const name = email.split("@")[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {name}</h1>
        <p className="text-sm text-slate-500 mt-1">
          {isAdmin ? "Your campaign asset operating system at a glance." : "Find and download approved campaign resources."}
        </p>
      </div>

      {/* Quick search */}
      <form
        onSubmit={(e) => { e.preventDefault(); window.location.href = `/files?q=${encodeURIComponent(q)}`; }}
        className="flex gap-2"
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns and resources…"
          className="w-full max-w-lg rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
        <button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">Search</button>
        <Link href="/library" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100">Browse library</Link>
      </form>

      {isAdmin && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Stat label="Total assets" value={a ? a.totals.assets.toLocaleString() : "—"} />
            <Stat label="Users" value={a ? a.totals.users.toLocaleString() : "—"} />
            <Stat label="Campaigns" value={a ? a.totals.campaigns.toLocaleString() : "—"} />
            <Stat label="Active share links" value={a ? a.totals.activeShareLinks.toLocaleString() : "—"} />
            <Stat label="Storage used" value={a ? fmtBytes(a.totals.storageBytes) : "—"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Widget title="Most downloaded assets">
              {(a?.mostDownloaded ?? []).map((f) => (
                <Row key={f.id} left={<Link href={`/files/${f.id}`} className="hover:text-indigo-600">{f.name}</Link>} right={`${f.download_count} ↓`} />
              ))}
              {a && a.mostDownloaded.length === 0 && <Empty />}
            </Widget>
            <Widget title="Most active users">
              {(a?.mostActiveUsers ?? []).map((u) => <Row key={u.email} left={u.email} right={`${u.downloads} ↓`} />)}
              {a && a.mostActiveUsers.length === 0 && <Empty />}
            </Widget>
            <Widget title="Recently uploaded">
              {(a?.recentUploads ?? []).map((f) => (
                <Row key={f.id} left={<Link href={`/files/${f.id}`} className="hover:text-indigo-600">{f.name}</Link>} right={new Date(f.created_at).toLocaleDateString()} />
              ))}
              {a && a.recentUploads.length === 0 && <Empty />}
            </Widget>
            <Widget title="Recent share links">
              {(a?.recentShareLinks ?? []).map((l) => (
                <Row key={l.id} left={l.name || "Untitled"} right={`${l.current_downloads} ↓ · ${l.status}`} />
              ))}
              {a && a.recentShareLinks.length === 0 && <Empty />}
            </Widget>
          </div>
        </>
      )}

      <div className={panel}>
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Recently added</div>
        {recent.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">Nothing here yet.</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {recent.map((f) => (
              <li key={f.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <Link href={`/files/${f.id}`} className="font-medium text-slate-800 hover:text-indigo-600 truncate">{f.name}</Link>
                <span className="text-slate-400 text-xs">{new Date(f.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
    <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
  </div>
);
const Widget = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className={panel}>
    <div className="px-5 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">{title}</div>
    <ul className="divide-y divide-slate-50">{children}</ul>
  </div>
);
const Row = ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
  <li className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
    <span className="min-w-0 truncate text-slate-700">{left}</span>
    <span className="shrink-0 text-xs text-slate-400">{right}</span>
  </li>
);
const Empty = () => <li className="px-5 py-6 text-center text-xs text-slate-400">No data yet.</li>;
