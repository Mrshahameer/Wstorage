// Shown instantly on every dashboard navigation while the page's data loads,
// so switching tabs feels immediate instead of waiting on the server.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-52 rounded-lg bg-slate-200" />
        <div className="h-4 w-80 rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl border border-slate-100 bg-white/60" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-slate-100 bg-white/60" />
    </div>
  );
}
