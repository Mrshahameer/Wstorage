"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Category = { id: string; name: string };
type Vertical = { id: string; category_id: string; name: string };
type Campaign = { id: string; vertical_id: string; name: string; buyer: string | null };
type Folder = { id: string; name: string; path: string; parent_id: string | null; campaign_id: string | null };
type NodeKey = string; // `${type}:${id}`

const key = (type: string, id: string): NodeKey => `${type}:${id}`;

// One tri-state checkbox: checked (explicit), inherited (an ancestor is checked), or
// indeterminate (some descendants are checked). Inherited rows are shown ticked and locked.
function TriCheck({ checked, inherited, partial, onChange }: {
  checked: boolean; inherited: boolean; partial: boolean; onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = partial && !checked && !inherited; }, [partial, checked, inherited]);
  return (
    <input ref={ref} type="checkbox" checked={checked || inherited} disabled={inherited}
      onChange={onChange} className={"rounded " + (inherited ? "opacity-50" : "")} />
  );
}

export function AccessTree({ userId, email, onClose, onSaved }: {
  userId: string; email: string; onClose: () => void; onSaved: () => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [checked, setChecked] = useState<Set<NodeKey>>(new Set());
  const [open, setOpen] = useState<Set<NodeKey>>(new Set());
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

  // ---- tree structure -------------------------------------------------------------
  const tree = useMemo(() => {
    const vertsByCat = new Map<string, Vertical[]>();
    verticals.forEach((v) => vertsByCat.set(v.category_id, [...(vertsByCat.get(v.category_id) ?? []), v]));
    const campsByVert = new Map<string, Campaign[]>();
    campaigns.forEach((c) => campsByVert.set(c.vertical_id, [...(campsByVert.get(c.vertical_id) ?? []), c]));
    const topFoldersByCamp = new Map<string, Folder[]>();
    const subFolders = new Map<string, Folder[]>();
    const orphan: Folder[] = [];
    const ids = new Set(folders.map((f) => f.id));
    folders.forEach((f) => {
      if (f.parent_id && ids.has(f.parent_id)) subFolders.set(f.parent_id, [...(subFolders.get(f.parent_id) ?? []), f]);
      else if (f.campaign_id) topFoldersByCamp.set(f.campaign_id, [...(topFoldersByCamp.get(f.campaign_id) ?? []), f]);
      else orphan.push(f);
    });
    // child keys for every node, plus the parent of every node
    const children = new Map<NodeKey, NodeKey[]>();
    const parent = new Map<NodeKey, NodeKey>();
    const link = (p: NodeKey, c: NodeKey) => { children.set(p, [...(children.get(p) ?? []), c]); parent.set(c, p); };
    categories.forEach((c) => (vertsByCat.get(c.id) ?? []).forEach((v) => {
      link(key("category", c.id), key("vertical", v.id));
      (campsByVert.get(v.id) ?? []).forEach((cp) => {
        link(key("vertical", v.id), key("campaign", cp.id));
        (topFoldersByCamp.get(cp.id) ?? []).forEach((f) => link(key("campaign", cp.id), key("folder", f.id)));
      });
    }));
    folders.forEach((f) => { if (f.parent_id && ids.has(f.parent_id)) link(key("folder", f.parent_id), key("folder", f.id)); });
    return { vertsByCat, campsByVert, topFoldersByCamp, subFolders, orphan, children, parent };
  }, [categories, verticals, campaigns, folders]);

  const descendants = useCallback((k: NodeKey): NodeKey[] => {
    const out: NodeKey[] = []; const stack = [...(tree.children.get(k) ?? [])];
    while (stack.length) { const n = stack.pop()!; out.push(n); stack.push(...(tree.children.get(n) ?? [])); }
    return out;
  }, [tree]);
  const inheritedFrom = (k: NodeKey) => {
    let p = tree.parent.get(k);
    while (p) { if (checked.has(p)) return true; p = tree.parent.get(p); }
    return false;
  };
  const hasCheckedBelow = (k: NodeKey) => descendants(k).some((d) => checked.has(d));

  // open the branches that already hold grants
  useEffect(() => {
    if (loading) return;
    const o = new Set<NodeKey>();
    checked.forEach((k) => { let p = tree.parent.get(k); while (p) { o.add(p); p = tree.parent.get(p); } });
    setOpen(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const toggleOpen = (k: NodeKey) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggle = (k: NodeKey) => setChecked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else { n.add(k); descendants(k).forEach((d) => n.delete(d)); } // one check covers everything below it
    return n;
  });
  const expandAll = () => setOpen(new Set(Array.from(tree.children.keys())));
  const collapseAll = () => setOpen(new Set());

  async function save() {
    setSaving(true); setError("");
    const nodes = Array.from(checked).map((k) => { const [type, id] = k.split(":"); return { type, id }; });
    const res = await fetch("/api/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, nodes }) });
    setSaving(false);
    if (!res.ok) return setError((await res.json()).error || "Failed to save");
    onSaved(); onClose();
  }

  // ---- rendering ------------------------------------------------------------------
  const Row = ({ k, label, sub, hint, expandable }: { k: NodeKey; label: string; sub?: string; hint?: string; expandable: boolean }) => {
    const inh = inheritedFrom(k);
    return (
      <div className="flex items-center gap-1 py-0.5">
        {expandable
          ? <button type="button" onClick={() => toggleOpen(k)} className="inline-block w-4 text-slate-400">{open.has(k) ? "▾" : "▸"}</button>
          : <span className="inline-block w-4" />}
        <label className="flex items-center gap-2 text-sm">
          <TriCheck checked={checked.has(k)} inherited={inh} partial={hasCheckedBelow(k)} onChange={() => toggle(k)} />
          <span className="text-slate-700">{label}</span>
          {sub && <span className="text-xs text-slate-400">{sub}</span>}
          {hint && !inh && <span className="text-[10px] uppercase tracking-wide text-indigo-400">{hint}</span>}
          {inh && <span className="text-[10px] uppercase tracking-wide text-slate-300">included</span>}
        </label>
      </div>
    );
  };
  const Indent = ({ children }: { children: React.ReactNode }) => <div className="ml-5 border-l border-slate-100 pl-3">{children}</div>;
  const FolderNode = ({ f }: { f: Folder }) => {
    const k = key("folder", f.id); const subs = tree.subFolders.get(f.id) ?? [];
    return (
      <div>
        <Row k={k} label={f.name} expandable={subs.length > 0} />
        {open.has(k) && subs.length > 0 && <Indent>{subs.map((s) => <FolderNode key={s.id} f={s} />)}</Indent>}
      </div>
    );
  };

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
              <p className="text-xs text-slate-500 mb-2">
                One check gives everything below it: a <b>category</b> gives all its verticals, a <b>vertical</b> gives all its campaign types,
                a <b>campaign type</b> gives all its folders. Open a branch to pick single folders instead.
              </p>
              <div className="mb-3 flex gap-3 text-xs">
                <button type="button" onClick={expandAll} className="text-indigo-600 hover:underline">Expand all</button>
                <button type="button" onClick={collapseAll} className="text-indigo-600 hover:underline">Collapse all</button>
              </div>
              <div className="space-y-0.5">
                {categories.map((c) => {
                  const ck = key("category", c.id); const verts = tree.vertsByCat.get(c.id) ?? [];
                  return (
                    <div key={c.id}>
                      <Row k={ck} label={c.name} hint="full category" expandable />
                      {open.has(ck) && (
                        <Indent>
                          {verts.length === 0 && <p className="text-xs text-slate-400 py-1">No verticals.</p>}
                          {verts.map((v) => {
                            const vk = key("vertical", v.id); const camps = tree.campsByVert.get(v.id) ?? [];
                            return (
                              <div key={v.id}>
                                <Row k={vk} label={v.name} hint="full vertical" expandable />
                                {open.has(vk) && (
                                  <Indent>
                                    {camps.length === 0 && <p className="text-xs text-slate-400 py-1">No campaigns.</p>}
                                    {camps.map((cp) => {
                                      const pk = key("campaign", cp.id); const fl = tree.topFoldersByCamp.get(cp.id) ?? [];
                                      return (
                                        <div key={cp.id}>
                                          <Row k={pk} label={cp.name} sub={cp.buyer || undefined} hint="full campaign" expandable={fl.length > 0} />
                                          {open.has(pk) && fl.length > 0 && <Indent>{fl.map((f) => <FolderNode key={f.id} f={f} />)}</Indent>}
                                        </div>
                                      );
                                    })}
                                  </Indent>
                                )}
                              </div>
                            );
                          })}
                        </Indent>
                      )}
                    </div>
                  );
                })}
                {categories.length === 0 && <p className="text-xs text-slate-400">No categories. Create them in Campaign management.</p>}
              </div>

              {/* Folders that belong to no campaign (older folders) */}
              {tree.orphan.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Other folders</h3>
                  {tree.orphan.map((f) => <Row key={f.id} k={key("folder", f.id)} label={f.path || f.name} expandable={false} />)}
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
