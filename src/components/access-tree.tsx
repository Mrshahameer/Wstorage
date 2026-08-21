"use client";
import { useCallback, useEffect, useState } from "react";

type Category = { id: string; name: string };
type Vertical = { id: string; category_id: string; name: string };
type Campaign = { id: string; vertical_id: string; name: string; buyer: string | null };
type Folder = { id: string; name: string; path: string };
type NodeKey = string; // `${type}:${id}`

const key = (type: string, id: string): NodeKey => `${type}:${id}`;

export function AccessTree({ userId, email, onClose, onSaved }: {
  userId: string; email: string; onClose: () => void; onSaved: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [checked, setChecked] = useState<Set<NodeKey>>(new Set());
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openVerts, setOpenVerts] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const j = async (u: string) => (await fetch(u)).json();
  const load = useCallback(async () => {
    setLoading(true);
    const [c, v, cp, f, g] = await Promise.all([
      j("/api/categories"), j("/api/verticals"), j("/api/campaigns"), j("/api/folders"), j(`/api/permissions?userId=${userId}`),
    ]);
    setCategories(c.categories ?? []);
    setVerticals(v.verticals ?? []);
    setCampaigns(cp.campaigns ?? []);
    setFolders(f.folders ?? []);
    setChecked(new Set((g.nodes ?? []).map((n: { resource_type: string; resource_id: string }) => key(n.resource_type, n.resource_id))));
    setLoading(false);
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const toggle = (k: NodeKey) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isOn = (k: NodeKey) => checked.has(k);
  const toggleOpen = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    set((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function save() {
    setSaving(true); setError("");
    const nodes = Array.from(checked).map((k) => { const [type, id] = k.split(":"); return { type, id }; });
    const res = await fetch("/api/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, nodes }) });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error || "Failed to save");
    onSaved(); onClose();
  }

  const Check = ({ k, label, sub }: { k: NodeKey; label: string; sub?: string }) => (
    <label className="flex items-center gap-2 text-sm py-0.5">
      <input type="checkbox" checked={isOn(k)} onChange={() => toggle(k)} className="rounded" />
      <span className="text-slate-700">{label}</span>
      {sub && <span className="text-xs text-slate-400">{sub}</span>}
    </label>
  );
  const caret = (open: boolean) => <span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="mt-12 w-full max-w-lg rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold">Manage access</h2>
            <p className="text-xs text-slate-500">{email}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-6">
          {loading ? <p className="text-sm text-slate-400">Loading…</p> : (
            <>
              <p className="text-xs text-slate-500 mb-3">
                Check any level to grant view + download. Grants inherit downward (check a vertical → its campaigns come with it).
              </p>
              {/* Category tree */}
              <div className="space-y-1">
                {categories.map((c) => {
                  const catOpen = openCats.has(c.id);
                  const verts = verticals.filter((v) => v.category_id === c.id);
                  return (
                    <div key={c.id}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => toggleOpen(setOpenCats, c.id)}>{caret(catOpen)}</button>
                        <Check k={key("category", c.id)} label={c.name} />
                      </div>
                      {catOpen && (
                        <div className="ml-6 border-l border-slate-100 pl-3">
                          {verts.length === 0 && <p className="text-xs text-slate-400 py-1">No verticals.</p>}
                          {verts.map((v) => {
                            const vOpen = openVerts.has(v.id);
                            const camps = campaigns.filter((cp) => cp.vertical_id === v.id);
                            return (
                              <div key={v.id}>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => toggleOpen(setOpenVerts, v.id)}>{caret(vOpen)}</button>
                                  <Check k={key("vertical", v.id)} label={v.name} />
                                </div>
                                {vOpen && (
                                  <div className="ml-6 border-l border-slate-100 pl-3">
                                    {camps.length === 0 && <p className="text-xs text-slate-400 py-1">No campaigns.</p>}
                                    {camps.map((cp) => (
                                      <Check key={cp.id} k={key("campaign", cp.id)} label={cp.name} sub={cp.buyer || undefined} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {categories.length === 0 && <p className="text-xs text-slate-400">No categories — create them in Campaign management.</p>}
              </div>

              {/* Folders */}
              {folders.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Folders</h3>
                  <div className="space-y-0.5">
                    {folders.map((f) => <Check key={f.id} k={key("folder", f.id)} label={f.path || f.name} />)}
                  </div>
                </div>
              )}
              {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-400">{checked.size} selected</span>
          <div className="space-x-2">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
            <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{saving ? "Saving…" : "Save access"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
