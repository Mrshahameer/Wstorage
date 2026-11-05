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

export interface LibraryFacts {
  categories: number;
  verticals: number;
  campaigns: number;
  folders: number;
  files: number;
  categoryNames: string[];
  verticalNames: string[];
  campaignTypeNames: string[];
  scoped: boolean; // true = limited to what this user can access
}

/** Real counts + names, filtered to what the user can see. Grounds the assistant's answers. */
export async function buildFacts(user: SessionUser): Promise<LibraryFacts> {
  const db = supabaseAdmin();
  const names = async (table: string): Promise<string[]> => {
    const { data } = await db.from(table).select("name").order("name");
    return (data ?? []).map((r: { name: string }) => r.name);
  };

  if (isAdmin(user)) {
    const [cat, ver, cam, fol, fil, categoryNames, verticalNames, campaignTypeNames] = await Promise.all([
      db.from("categories").select("*", { count: "exact", head: true }),
      db.from("verticals").select("*", { count: "exact", head: true }),
      db.from("campaigns").select("*", { count: "exact", head: true }),
      db.from("folders").select("*", { count: "exact", head: true }),
      db.from("files").select("*", { count: "exact", head: true }).eq("status", "ready"),
      names("categories"),
      names("verticals"),
      names("campaign_types"),
    ]);
    return {
      categories: cat.count ?? 0,
      verticals: ver.count ?? 0,
      campaigns: cam.count ?? 0,
      folders: fol.count ?? 0,
      files: fil.count ?? 0,
      categoryNames, verticalNames, campaignTypeNames,
      scoped: false,
    };
  }

  // Non-admin: limit to the campaigns they can access.
  const scope = await accessScope(user.id);
  const campIds = scope.campaignIds;
  if (campIds.length === 0) {
    return { categories: 0, verticals: 0, campaigns: 0, folders: 0, files: 0, categoryNames: [], verticalNames: [], campaignTypeNames: [], scoped: true };
  }
  const [{ data: camps }, { data: verts }, { data: cats }, campaignTypeNames, fol] = await Promise.all([
    db.from("campaigns").select("vertical_id").in("id", campIds),
    db.from("verticals").select("id,name,category_id"),
    db.from("categories").select("id,name"),
    names("campaign_types"),
    db.from("folders").select("*", { count: "exact", head: true }).in("campaign_id", campIds),
  ]);
  const vMap = new Map<string, Vert>((verts ?? []).map((v: Vert) => [v.id, v]));
  const cMap = new Map<string, Cat>((cats ?? []).map((c: Cat) => [c.id, c]));
  const vIds = new Set((camps ?? []).map((c: { vertical_id: string }) => c.vertical_id));
  const catIds = new Set<string>();
  const vNames: string[] = [];
  vIds.forEach((id) => { const v = vMap.get(id); if (v) { vNames.push(v.name); catIds.add(v.category_id); } });
  const cNames: string[] = [];
  catIds.forEach((id) => { const c = cMap.get(id); if (c) cNames.push(c.name); });

  return {
    categories: catIds.size,
    verticals: vIds.size,
    campaigns: campIds.length,
    folders: fol.count ?? 0,
    files: 0,
    categoryNames: cNames.sort(),
    verticalNames: vNames.sort(),
    campaignTypeNames,
    scoped: true,
  };
}

/** Compact facts block for the AI prompt. */
export function factsToString(f: LibraryFacts): string {
  const lines = [
    `${f.scoped ? "You can access" : "The library has"}: ${f.categories} categories, ${f.verticals} verticals, ${f.campaigns} campaigns, ${f.folders} folders${f.files ? `, ${f.files} files` : ""}.`,
    f.categoryNames.length ? `Categories: ${f.categoryNames.join(", ")}.` : "",
    f.verticalNames.length ? `Verticals: ${f.verticalNames.join(", ")}.` : "",
    f.campaignTypeNames.length ? `Campaign types: ${f.campaignTypeNames.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Deterministic answer for count/list questions when AI is off. */
export function deterministicAnswer(query: string, f: LibraryFacts): string {
  const q = query.toLowerCase();
  const who = f.scoped ? "You can access" : "You have";
  if (/campaign/.test(q)) return `${who} ${f.campaigns} campaigns across ${f.verticals} verticals and ${f.categories} categories.`;
  if (/vertical/.test(q)) return `${who} ${f.verticals} verticals: ${f.verticalNames.join(", ")}.`;
  if (/categor/.test(q)) return `${who} ${f.categories} categories: ${f.categoryNames.join(", ")}.`;
  if (/folder/.test(q)) return `${who} ${f.folders} folders across ${f.campaigns} campaigns.`;
  if (/campaign type|type of campaign/.test(q)) return `Campaign types: ${f.campaignTypeNames.join(", ")}.`;
  return `${who} ${f.categories} categories, ${f.verticals} verticals, ${f.campaigns} campaigns, and ${f.folders} folders. Ask me to find any of them.`;
}

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
      if (intent.campaign && name.includes(intent.campaign.toLowerCase())) score += 0.55;
      if (intent.vertical && v && v.name.toLowerCase().includes(intent.vertical.toLowerCase())) score += 0.35;
      if (intent.category && cat && cat.name.toLowerCase().includes(intent.category.toLowerCase())) score += 0.2;
      // Per-term matches: a hit in the campaign name counts more than in the path.
      terms.forEach((t) => {
        if (t.length < 2) return;
        if (name.includes(t)) score += 0.14;
        else if (hay.includes(t)) score += 0.05;
      });
      return { c, v, cat, score: Math.min(1, score) };
    })
    .filter((x) => x.score >= 0.2)
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
