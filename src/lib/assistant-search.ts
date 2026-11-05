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
  resourceType: "folder" | "campaign"; // what a share link should target
}

interface Camp { id: string; name: string; vertical_id: string }
interface Vert { id: string; name: string; category_id: string }
interface Cat { id: string; name: string }
interface Folder { id: string; name: string; campaign_id: string | null }

// Maps an asset type (from the query) to the standard campaign folder it lives in.
// Each entry is a list of keywords; the first folder whose name contains any of
// them wins. Covers the 7 standard folders plus common synonyms.
const FOLDER_KEYWORDS: { label: string; keys: string[] }[] = [
  { label: "Creatives", keys: ["creative", "ad", "banner", "image", "graphic"] },
  { label: "Landing Pages", keys: ["landing", "lander", "lp", "page"] },
  { label: "Agent Scripts", keys: ["script", "pitch", "rebuttal"] },
  { label: "Verification Recordings", keys: ["recording", "recordings", "verification", "call recording"] },
  { label: "Data Samples", keys: ["data sample", "sample", "lead sample", "data"] },
  { label: "TCPA & Compliance", keys: ["tcpa", "compliance", "consent", "disclosure"] },
  { label: "Other Assets", keys: ["other", "misc"] },
];

/** Which folder keyword group an asset_type points at, or null if none. */
function folderGroupFor(assetType: string | null): string[] | null {
  if (!assetType) return null;
  const a = assetType.toLowerCase();
  for (const g of FOLDER_KEYWORDS) {
    if (g.keys.some((k) => a.includes(k) || k.includes(a))) return g.keys;
  }
  return null;
}

/** Does a folder name match the asset-type keyword group? */
function folderMatches(name: string, keys: string[]): boolean {
  const n = name.toLowerCase();
  return keys.some((k) => n.includes(k));
}

export interface LibraryFacts {
  categories: number;
  verticals: number;
  campaigns: number;
  folders: number;
  files: number;
  categoryNames: string[];
  verticalNames: string[];
  campaignTypeNames: string[];
  perVertical: { name: string; campaigns: number }[];
  perCategory: { name: string; verticals: number; campaigns: number }[];
  scoped: boolean; // true = limited to what this user can access
}

/** Roll a list of campaign vertical_ids up into per-vertical and per-category counts. */
function rollUp(verticalIds: string[], vMap: Map<string, Vert>, cMap: Map<string, Cat>) {
  const perV = new Map<string, number>();
  const perCCamp = new Map<string, number>();
  const perCVert = new Map<string, Set<string>>();
  for (const vid of verticalIds) {
    const v = vMap.get(vid);
    if (!v) continue;
    perV.set(vid, (perV.get(vid) ?? 0) + 1);
    perCCamp.set(v.category_id, (perCCamp.get(v.category_id) ?? 0) + 1);
    (perCVert.get(v.category_id) ?? perCVert.set(v.category_id, new Set()).get(v.category_id)!).add(vid);
  }
  const perVertical = [...perV.entries()]
    .map(([vid, n]) => ({ name: vMap.get(vid)?.name ?? "", campaigns: n }))
    .filter((x) => x.name)
    .sort((a, b) => b.campaigns - a.campaigns);
  const perCategory = [...perCCamp.entries()]
    .map(([cid, n]) => ({ name: cMap.get(cid)?.name ?? "", verticals: perCVert.get(cid)?.size ?? 0, campaigns: n }))
    .filter((x) => x.name)
    .sort((a, b) => b.campaigns - a.campaigns);
  return { perVertical, perCategory };
}

/** Real counts + names, filtered to what the user can see. Grounds the assistant's answers. */
export async function buildFacts(user: SessionUser): Promise<LibraryFacts> {
  const db = supabaseAdmin();
  const admin = isAdmin(user);

  let campIds: string[] | null = null;
  if (!admin) {
    const scope = await accessScope(user.id);
    campIds = scope.campaignIds;
    if (campIds.length === 0) {
      return { categories: 0, verticals: 0, campaigns: 0, folders: 0, files: 0, categoryNames: [], verticalNames: [], campaignTypeNames: [], perVertical: [], perCategory: [], scoped: true };
    }
  }

  const campQ = admin ? db.from("campaigns").select("vertical_id") : db.from("campaigns").select("vertical_id").in("id", campIds!);
  const folQ = admin ? db.from("folders").select("*", { count: "exact", head: true }) : db.from("folders").select("*", { count: "exact", head: true }).in("campaign_id", campIds!);
  const filQ = admin
    ? db.from("files").select("*", { count: "exact", head: true }).eq("status", "ready")
    : db.from("files").select("*", { count: "exact", head: true }).eq("status", "ready").in("campaign_id", campIds!);

  const [{ data: camps }, { data: verts }, { data: cats }, { data: ctypes }, fol, fil] = await Promise.all([
    campQ,
    db.from("verticals").select("id,name,category_id").order("name"),
    db.from("categories").select("id,name").order("name"),
    db.from("campaign_types").select("name").order("name"),
    folQ,
    filQ,
  ]);

  const vMap = new Map<string, Vert>((verts ?? []).map((v: Vert) => [v.id, v]));
  const cMap = new Map<string, Cat>((cats ?? []).map((c: Cat) => [c.id, c]));
  const verticalIds = (camps ?? []).map((c: { vertical_id: string }) => c.vertical_id);
  const { perVertical, perCategory } = rollUp(verticalIds, vMap, cMap);

  return {
    categories: perCategory.length,
    verticals: perVertical.length,
    campaigns: verticalIds.length,
    folders: fol.count ?? 0,
    files: fil.count ?? 0,
    categoryNames: perCategory.map((c) => c.name).sort(),
    verticalNames: perVertical.map((v) => v.name).sort(),
    campaignTypeNames: (ctypes ?? []).map((t: { name: string }) => t.name),
    perVertical,
    perCategory,
    scoped: !admin,
  };
}

/** Compact facts block for the AI prompt. Includes per-vertical counts so the AI can quote real numbers. */
export function factsToString(f: LibraryFacts): string {
  const perV = f.perVertical.map((v) => `${v.name} (${v.campaigns})`).join(", ");
  const perC = f.perCategory.map((c) => `${c.name} (${c.verticals} verticals, ${c.campaigns} campaigns)`).join(", ");
  const lines = [
    `${f.scoped ? "You can access" : "The library has"}: ${f.categories} categories, ${f.verticals} verticals, ${f.campaigns} campaigns, ${f.folders} folders${f.files ? `, ${f.files} files` : ""}.`,
    perC ? `Campaigns per category: ${perC}.` : "",
    perV ? `Campaigns per vertical: ${perV}.` : "",
    f.campaignTypeNames.length ? `Campaign types: ${f.campaignTypeNames.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Deterministic answer for count/list questions when AI is off. Runs on the real facts. */
export function deterministicAnswer(query: string, f: LibraryFacts): string {
  const q = query.toLowerCase();
  const who = f.scoped ? "You can access" : "You have";

  // "how many campaigns in <vertical>" / "<category>" — quote the real number.
  const vHit = f.perVertical.find((v) => v.name && q.includes(v.name.toLowerCase()));
  if (vHit && /campaign|how many|total|number/.test(q)) {
    return `${vHit.name} has ${vHit.campaigns} campaign${vHit.campaigns === 1 ? "" : "s"}.`;
  }
  const cHit = f.perCategory.find((c) => c.name && q.includes(c.name.toLowerCase()));
  if (cHit && /campaign|vertical|how many|total|number/.test(q)) {
    return `${cHit.name} has ${cHit.verticals} vertical${cHit.verticals === 1 ? "" : "s"} and ${cHit.campaigns} campaign${cHit.campaigns === 1 ? "" : "s"}.`;
  }

  if (/file/.test(q)) return `${who} ${f.files} files across ${f.campaigns} campaigns.`;
  if (/folder/.test(q)) return `${who} ${f.folders} folders across ${f.campaigns} campaigns.`;
  if (/campaign type|type of campaign/.test(q)) return `Campaign types: ${f.campaignTypeNames.join(", ")}.`;
  if (/vertical/.test(q)) return `${who} ${f.verticals} verticals: ${f.verticalNames.join(", ")}.`;
  if (/categor/.test(q)) return `${who} ${f.categories} categories: ${f.categoryNames.join(", ")}.`;
  if (/campaign/.test(q)) return `${who} ${f.campaigns} campaigns across ${f.verticals} verticals and ${f.categories} categories.`;
  return `${who} ${f.categories} categories, ${f.verticals} verticals, ${f.campaigns} campaigns, ${f.folders} folders, and ${f.files} files. Ask me to find or count any of them.`;
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
export async function searchCampaigns(user: SessionUser, intent: Intent, query = ""): Promise<AssistantResult[]> {
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

  // Meaningful query tokens, from the raw query plus anything the AI pulled out.
  const hintText = [query, intent.vertical, intent.campaign, intent.category, intent.asset_type, ...intent.keywords]
    .filter(Boolean)
    .join(" ");
  const terms = new Set<string>([...expandTerms(hintText), ...intent.keywords.map((k) => k.toLowerCase())]);
  terms.delete("");
  const group = folderGroupFor(intent.asset_type);
  const assetToken = (intent.asset_type ?? "").toLowerCase();
  const qLc = query.toLowerCase().trim();
  // Tokens that describe the asset type, so they don't penalize a campaign that
  // holds the folder rather than naming it.
  const assetTerms = new Set<string>(group ? expandTerms(group.join(" ")) : []);

  const scored = (camps ?? [])
    .filter((c: Camp) => !allowed || allowed.has(c.id))
    .map((c: Camp) => {
      const v = vMap.get(c.vertical_id);
      const cat = v ? cMap.get(v.category_id) : undefined;
      const name = c.name.toLowerCase();
      // The haystack already includes the asset type, since a matching folder is
      // part of the answer even when the campaign name does not say it.
      const hay = `${c.name} ${v?.name ?? ""} ${cat?.name ?? ""} ${assetToken}`.toLowerCase();

      // Coverage: what fraction of the query's meaningful tokens this result covers.
      let total = 0, hit = 0;
      terms.forEach((t) => {
        if (t.length < 2) return;
        total += 1;
        if (hay.includes(t)) hit += 1;
      });
      let score = total ? hit / total : 0;

      // Strong, explicit signals snap the score up so an exact match reads ~100%.
      if (qLc && name && qLc.includes(name)) score = Math.max(score, 0.98);
      if (intent.campaign && name === intent.campaign.toLowerCase()) score = 1;
      else if (intent.campaign && name.includes(intent.campaign.toLowerCase())) score = Math.max(score, 0.9);

      // When every non-asset query token is in this campaign's path, it is the one.
      const coreMiss = [...terms].some((t) => t.length >= 2 && !assetTerms.has(t) && !hay.includes(t));
      if (!coreMiss && total > 0) score = Math.max(score, 0.95);

      return { c, v, cat, score: Math.min(1, score) };
    })
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // When the query names an asset type (agent scripts, data samples, creatives…),
  // return the specific folder inside each matching campaign and link straight to
  // it. Otherwise link to the campaign, which opens its folders grouped.
  const folderByCampaign = new Map<string, Folder>();
  if (group && scored.length) {
    const { data: folders } = await db
      .from("folders")
      .select("id,name,campaign_id")
      .in("campaign_id", scored.map((x) => x.c.id));
    for (const f of (folders ?? []) as Folder[]) {
      if (!f.campaign_id || folderByCampaign.has(f.campaign_id)) continue;
      if (folderMatches(f.name, group)) folderByCampaign.set(f.campaign_id, f);
    }
  }

  return scored.map((x) => {
    const folder = folderByCampaign.get(x.c.id) ?? null;
    const basePath = [x.cat?.name, x.v?.name, x.c.name].filter(Boolean);
    if (folder) {
      return {
        id: folder.id,
        title: `${x.c.name} — ${folder.name}`,
        path: [...basePath, folder.name].join("  ›  "),
        score: Math.min(1, Math.round(x.score * 100) / 100),
        link: `/library?campaignId=${x.c.id}&folderId=${folder.id}`,
        assetHint: folder.name,
        resourceType: "folder",
      };
    }
    return {
      id: x.c.id,
      title: x.c.name,
      path: basePath.join("  ›  "),
      score: Math.min(1, Math.round(x.score * 100) / 100),
      link: `/library?campaignId=${x.c.id}`,
      assetHint: intent.asset_type,
      resourceType: "campaign",
    };
  });
}
