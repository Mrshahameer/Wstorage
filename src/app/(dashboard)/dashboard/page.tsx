import { supabaseAdmin } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import { KeyRequestsPanel } from "@/components/key-requests-panel";
import { PersonalKeyWizard } from "@/components/personal-key-wizard";

function fmtBytes(n: number) {
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

async function loadStats() {
  const db = supabaseAdmin();
  try {
    const [{ count: files }, { count: downloads }, { count: users }, { data: sizeRows }, { data: activity }] =
      await Promise.all([
        db.from("files").select("id", { count: "exact", head: true }).eq("status", "ready"),
        db.from("downloads").select("id", { count: "exact", head: true }),
        db.from("profiles").select("id", { count: "exact", head: true }),
        db.from("files").select("size_bytes").eq("status", "ready"),
        db.from("activity_logs").select("action,detail,created_at").order("created_at", { ascending: false }).limit(8),
      ]);
    const totalBytes = (sizeRows ?? []).reduce((a: number, r: { size_bytes: number }) => a + Number(r.size_bytes || 0), 0);
    return { files: files ?? 0, downloads: downloads ?? 0, users: users ?? 0, totalBytes, activity: activity ?? [] };
  } catch {
    return { files: 0, downloads: 0, users: 0, totalBytes: 0, activity: [] };
  }
}

export default async function DashboardPage() {
  const user = await getSessionUser();
  const s = await loadStats();
  const isSuper = user?.role === "super_admin";
  const cards = [
    { label: "Files", value: s.files.toLocaleString() },
    { label: "Storage used", value: fmtBytes(s.totalBytes) },
    { label: "Downloads", value: s.downloads.toLocaleString() },
    { label: "Team members", value: s.users.toLocaleString() },
  ];
  return (
    <div className="space-y-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="text-sm text-slate-500 mt-1">Welcome back, {user?.email?.split("@")[0]}.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{c.label}</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Key Requests & Personal Storage Approval Panel */}
      <div className="grid grid-cols-1 gap-6">
        <KeyRequestsPanel isSuperAdmin={isSuper} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-5 py-3 border-b border-slate-100 text-sm font-medium text-slate-700">Recent activity</div>
        {s.activity.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {s.activity.map((a: { action: string; detail: Record<string, unknown>; created_at: string }, i: number) => (
              <li key={i} className="px-5 py-3 flex items-center justify-between text-sm">
                <span className="text-slate-700">
                  <span className="font-medium capitalize">{a.action.replace(/_/g, " ")}</span>
                  {a.detail?.name ? <span className="text-slate-500"> — {String(a.detail.name)}</span> : null}
                  {a.detail?.email ? <span className="text-slate-500"> — {String(a.detail.email)}</span> : null}
                </span>
                <span className="text-slate-400 text-xs">{new Date(a.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

