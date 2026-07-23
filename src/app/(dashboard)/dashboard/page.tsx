import { supabaseAdmin } from "@/lib/supabase/admin";

async function stats() {
  const db = supabaseAdmin();
  const [{ count: files }, { count: downloads }, { data: sizeRows }] = await Promise.all([
    db.from("files").select("id", { count: "exact", head: true }).eq("status", "ready"),
    db.from("downloads").select("id", { count: "exact", head: true }),
    db.from("files").select("size_bytes").eq("status", "ready"),
  ]);
  const totalBytes = (sizeRows ?? []).reduce((a, r) => a + Number(r.size_bytes || 0), 0);
  return { files: files ?? 0, downloads: downloads ?? 0, totalBytes };
}

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

export default async function DashboardPage() {
  const s = await stats();
  const cards = [
    { label: "Total Files", value: s.files.toLocaleString() },
    { label: "Storage Used", value: fmtBytes(s.totalBytes) },
    { label: "Total Downloads", value: s.downloads.toLocaleString() },
  ];
  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border bg-white p-5">
            <div className="text-sm text-neutral-500">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>
      <p className="mt-8 text-sm text-neutral-500">
        Analytics widgets (most-downloaded, active users, storage by provider) plug in here —
        the underlying tables (activity_logs, downloads) are already recording data.
      </p>
    </div>
  );
}
