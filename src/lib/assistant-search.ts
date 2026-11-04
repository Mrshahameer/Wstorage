// Deterministic retrieval + ranking for the Search Assistant. The AI layer only
// produces intent; this finds the real campaigns, filtered by the user's access.
// SERVER ONLY.
import { supabaseAdmin } from "@/lib/supabase/admin";
import { accessScope, isAdmin } from "@/lib/access";
import type { SessionUser } from "@/lib/auth";
import { expandTerms, type Intent } from "@/lib/ai";

export interface AssistantResult {
  id: string;
  title: string;
  path: string;
  score: number; // 0..1
  link: string;
  assetHint: string | null;
}

interface Camp { id: string; name: string; vertical_id: string }
interface Vert { id: string; name: string; category_id: string }
interface Cat { id: string; name: string }

/** A compact taxonomy string to ground the AI's term mapping. */
export async function buildTaxonomy(): Promise<string> {
  const db = supabaseAdmin();
  const [{ data: cats }, { data: verts }, { data: ctypes }] = await Promise.all([
    db.from("categories").select("id,name").order("name"),
    db.from("verticals").select("id,name,category_id").order("name"),
    db.from("campaign_types").select("name").order("name"),
  ]);
  const vByCat = new Map<string, string[]>();
  (verts ?? []).forEach((v: Vert) => {
    const a = vByCat.get(v.category_id) ?? [];
    a.push(v.name);
    vByCat.set(v.category_id, a);
  });
  const lines = (cats ?? []).map((c: Cat) => `- ${c.name}: ${(vByCat.get(c.id) ?? []).join(", ")}`);
  const types = (ctypes ?? []).map((t: { name: string }) => t.name).join(", ");
  return lines.join("\n") + (types ? `\nCampaign types: ${types}` : "");
}

/** Rank campaigns the user can access against the parsed intent. Top 5. */
export async function searchCampaigns(user: SessionUser, intent: Intent): Promise<AssistantResult[]> {
  const db = supabaseAdmin();

  let allowed: Set<string> | null = null;
  if (!isAdmin(user)) {
    const scope = await accessScope(user.id);
    allowed = new Set(scope.campaignIds);
    if (allowed.size === 0) return [];
  }

  const [{ data: camps }, { data: verts }, { data: cats }] = await Promise.all([
    db.from("campaigns").select("id,name,vertical_id"),
    db.from("verticals").select("id,name,category_id"),
    db.from("categories").select("id,name"),
  ]);
  const vMap = new Map<string, Vert>((verts ?? []).map((v: Vert) => [v.id, v]));
  const cMap = new Map<string, Cat>((cats ?? []).map((c: Cat) => [c.id, c]));

  const hintText = [intent.vertical, intent.campaign, intent.category, intent.asset_type, ...intent.keywords]
    .filter(Boolean)
    .join(" ");
  const terms = new Set<string>([...expandTerms(hintText), ...intent.keywords.map((k) => k.toLowerCase())]);

  const scored = (camps ?? [])
    .filter((c: Camp) => !allowed || allowed.has(c.id))
    .map((c: Camp) => {
      const v = vMap.get(c.vertical_id);
      const cat = v ? cMap.get(v.category_id) : undefined;
      const name = c.name.toLowerCase();
      const hay = `${c.name} ${v?.name ?? ""} ${cat?.name ?? ""}`.toLowerCase();
      let score = 0;
      if (intent.campaign && name.includes(intent.campaign.toLowerCase())) score += 0.5;
      if (intent.vertical && v && v.name.toLowerCase().includes(intent.vertical.toLowerCase())) score += 0.3;
      if (intent.category && cat && cat.name.toLowerCase().includes(intent.category.toLowerCase())) score += 0.15;
      let hits = 0;
      terms.forEach((t) => { if (t.length > 1 && hay.includes(t)) hits++; });
      if (terms.size) score += 0.5 * (hits / terms.size);
      return { c, v, cat, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map((x) => ({
    id: x.c.id,
    title: x.c.name,
    path: [x.cat?.name, x.v?.name, x.c.name].filter(Boolean).join("  ›  "),
    score: Math.min(1, Math.round(x.score * 100) / 100),
    link: `/files?campaignId=${x.c.id}`,
    assetHint: intent.asset_type,
  }));
}
