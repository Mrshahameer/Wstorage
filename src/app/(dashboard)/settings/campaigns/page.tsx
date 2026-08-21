"use client";
import { useCallback, useEffect, useState } from "react";

interface Category { id: string; name: string }
interface Vertical { id: string; category_id: string; name: string }
interface CampaignType { id: string; name: string }
interface Campaign { id: string; vertical_id: string; name: string; buyer: string | null; campaign_type_id: string | null }
interface ResourceType { id: string; name: string; is_system: boolean }

const card = "rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4";
const input = "flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500";
const btn = "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";
const chip = "rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700";

export default function CampaignManagementPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [verticals, setVerticals] = useState<Vertical[]>([]);
  const [types, setTypes] = useState<CampaignType[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [resourceTypes, setResourceTypes] = useState<ResourceType[]>([]);
  const [error, setError] = useState("");

  const [catName, setCatName] = useState("");
  const [selCat, setSelCat] = useState("");
  const [vertName, setVertName] = useState("");
  const [selVert, setSelVert] = useState("");
  const [campName, setCampName] = useState("");
  const [campBuyer, setCampBuyer] = useState("");
  const [campType, setCampType] = useState("");
  const [typeName, setTypeName] = useState("");
  const [rtName, setRtName] = useState("");

  const j = async (url: string) => (await fetch(url)).json();
  const load = useCallback(async () => {
    const [c, t, r] = await Promise.all([j("/api/categories"), j("/api/campaign-types"), j("/api/resource-types")]);
    setCategories(c.categories ?? []);
    setTypes(t.campaignTypes ?? []);
    setResourceTypes(r.resourceTypes ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadVerticals = useCallback(async (categoryId: string) => {
    if (!categoryId) return setVerticals([]);
    const v = await j(`/api/verticals?categoryId=${categoryId}`);
    setVerticals(v.verticals ?? []);
  }, []);
  useEffect(() => { loadVerticals(selCat); setSelVert(""); }, [selCat, loadVerticals]);

  const loadCampaigns = useCallback(async (verticalId: string) => {
    if (!verticalId) return setCampaigns([]);
    const c = await j(`/api/campaigns?verticalId=${verticalId}`);
    setCampaigns(c.campaigns ?? []);
  }, []);
  useEffect(() => { loadCampaigns(selVert); }, [selVert, loadCampaigns]);

  async function post(url: string, body: object, onOk: () => void) {
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) onOk();
    else setError((await res.json()).error || "Request failed");
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaign management</h1>
        <p className="text-sm text-slate-500 mt-1">
          Build the campaign tree: Category → Vertical → Campaign. All dynamic — no code changes needed.
        </p>
      </div>
      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{error}</div>}

      {/* Categories */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">1. Business categories</h2>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => <span key={c.id} className={chip}>{c.name}</span>)}
          {categories.length === 0 && <span className="text-xs text-slate-400">None yet.</span>}
        </div>
        <div className="flex gap-3">
          <input className={input} placeholder="e.g. Insurance" value={catName} onChange={(e) => setCatName(e.target.value)} />
          <button className={btn} disabled={!catName.trim()} onClick={() => post("/api/categories", { name: catName.trim() }, () => { setCatName(""); load(); })}>Add category</button>
        </div>
      </div>

      {/* Verticals */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">2. Verticals</h2>
        <select className={input} value={selCat} onChange={(e) => setSelCat(e.target.value)}>
          <option value="">Select a category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selCat && (
          <>
            <div className="flex flex-wrap gap-2">
              {verticals.map((v) => <span key={v.id} className={chip}>{v.name}</span>)}
              {verticals.length === 0 && <span className="text-xs text-slate-400">No verticals in this category yet.</span>}
            </div>
            <div className="flex gap-3">
              <input className={input} placeholder="e.g. Auto Insurance" value={vertName} onChange={(e) => setVertName(e.target.value)} />
              <button className={btn} disabled={!vertName.trim()} onClick={() => post("/api/verticals", { categoryId: selCat, name: vertName.trim() }, () => { setVertName(""); loadVerticals(selCat); })}>Add vertical</button>
            </div>
          </>
        )}
      </div>

      {/* Campaign types */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">3. Campaign types</h2>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => <span key={t.id} className={chip}>{t.name}</span>)}
        </div>
        <div className="flex gap-3">
          <input className={input} placeholder="e.g. Live Transfer" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
          <button className={btn} disabled={!typeName.trim()} onClick={() => post("/api/campaign-types", { name: typeName.trim() }, () => { setTypeName(""); load(); })}>Add type</button>
        </div>
      </div>

      {/* Campaigns */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">4. Campaigns</h2>
        <select className={input} value={selVert} onChange={(e) => setSelVert(e.target.value)} disabled={!selCat}>
          <option value="">{selCat ? "Select a vertical…" : "Pick a category above first"}</option>
          {verticals.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        {selVert && (
          <>
            <div className="space-y-1">
              {campaigns.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="font-medium">{c.name}</span>
                  {c.buyer && <span className="text-xs text-slate-400">· {c.buyer}</span>}
                </div>
              ))}
              {campaigns.length === 0 && <span className="text-xs text-slate-400">No campaigns in this vertical yet.</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input className={input} placeholder="Campaign name" value={campName} onChange={(e) => setCampName(e.target.value)} />
              <input className={input} placeholder="Buyer (optional)" value={campBuyer} onChange={(e) => setCampBuyer(e.target.value)} />
              <select className={input} value={campType} onChange={(e) => setCampType(e.target.value)}>
                <option value="">Campaign type (optional)…</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button className={btn} disabled={!campName.trim()} onClick={() => post("/api/campaigns", { verticalId: selVert, name: campName.trim(), buyer: campBuyer.trim() || undefined, campaignTypeId: campType || undefined }, () => { setCampName(""); setCampBuyer(""); setCampType(""); loadCampaigns(selVert); })}>Add campaign</button>
            </div>
          </>
        )}
      </div>

      {/* Resource types */}
      <div className={card}>
        <h2 className="text-sm font-semibold text-slate-800">Resource types</h2>
        <div className="flex flex-wrap gap-2">
          {resourceTypes.map((r) => (
            <span key={r.id} className={chip}>{r.name}{!r.is_system && " ★"}</span>
          ))}
        </div>
        <div className="flex gap-3">
          <input className={input} placeholder="Custom type, e.g. Buyer Requirements" value={rtName} onChange={(e) => setRtName(e.target.value)} />
          <button className={btn} disabled={!rtName.trim()} onClick={() => post("/api/resource-types", { name: rtName.trim() }, () => { setRtName(""); load(); })}>Add type</button>
        </div>
        <p className="text-xs text-slate-400">★ = custom type you created.</p>
      </div>
    </div>
  );
}
