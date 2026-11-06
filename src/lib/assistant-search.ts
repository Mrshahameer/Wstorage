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
  note?: string; // shown instead of a match score, e.g. "needs Verification Recordings"
}

export interface GapReport {
  label: string;
  missing: { id: string; name: string; path: string }[];
  have: number;
  total: number;
}

interface Camp { id: string; name: string; vertical_id: string }
interface Vert { id: string; name: string; category_id: string }
interface Cat { id: string; name: string }
interface Folder { id: string; name: string; campaign_id: string | null }

// Folder handling is fully data-driven: nothing here hardcodes the set of
// folders. We only turn an asset phrase into match tokens, bridging domain
// synonyms (ads -> creatives, call scripts -> agent scripts) through expandTerms,
// and then match those tokens against the REAL folder names in the database.
// New folder types added later are matched automatically with no code change.

/** Expand an asset phrase into lowercase match tokens (length >= 3). */
function assetTokens(text: string | null): Set<string> {
  const out = new Set<string>();
  for (const t of expandTerms(text || "")) if (t.length >= 3) out.add(t.toLowerCase());
  return out;
}

/** Does a real folder name contain any of the asset tokens? */
function nameMatchesTokens(name: string, tokens: Set<string>): boolean {
  const n = (name || "").toLowerCase();
  for (const t of tokens) if (n.includes(t)) return true;
  return false;
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
  perVertical: { name: string; campaigns: number; files: number }[];
  perCategory: { name: string; verticals: number; campaigns: number; files: number }[];
  folderTypes: { name: string; folders: number; files: number }[];
  campaignsList: { name: string; vertical: string; category: string }[];
  verticalsByCategory: Record<string, string[]>;
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
      return { categories: 0, verticals: 0, campaigns: 0, folders: 0, files: 0, categoryNames: [], verticalNames: [], campaignTypeNames: [], perVertical: [], perCategory: [], folderTypes: [], campaignsList: [], verticalsByCategory: {}, scoped: true };
    }
  }

  const campQ = admin ? db.from("campaigns").select("id,name,vertical_id") : db.from("campaigns").select("id,name,vertical_id").in("id", campIds!);
  const folQ = admin ? db.from("folders").select("id,name") : db.from("folders").select("id,name").in("campaign_id", campIds!);
  const filQ = admin
    ? db.from("files").select("folder_id,vertical_id,category_id").eq("status", "ready")
    : db.from("files").select("folder_id,vertical_id,category_id").eq("status", "ready").in("campaign_id", campIds!);

  const [{ data: camps }, { data: verts }, { data: cats }, { data: ctypes }, { data: folRows }, { data: filRows }] = await Promise.all([
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
  const rolled = rollUp(verticalIds, vMap, cMap);

  // Real campaign list (name + its vertical and category) for listing questions.
  const campaignsList = ((camps ?? []) as Camp[])
    .map((c) => {
      const v = vMap.get(c.vertical_id);
      const cat = v ? cMap.get(v.category_id) : undefined;
      return { name: c.name, vertical: v?.name ?? "", category: cat?.name ?? "" };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const vNameToCat = new Map<string, string>();
  for (const v of (verts ?? []) as Vert[]) { const c = cMap.get(v.category_id); if (c) vNameToCat.set(v.name, c.name); }
  const verticalsByCategory: Record<string, string[]> = {};
  for (const v of rolled.perVertical) { const cn = vNameToCat.get(v.name); if (cn) (verticalsByCategory[cn] ??= []).push(v.name); }

  // Real file counts per vertical and per category, from the files' own columns.
  const filesByVertName = new Map<string, number>();
  const filesByCatName = new Map<string, number>();
  for (const fi of (filRows ?? []) as { vertical_id: string | null; category_id: string | null }[]) {
    const vn = fi.vertical_id ? vMap.get(fi.vertical_id)?.name : null;
    if (vn) filesByVertName.set(vn, (filesByVertName.get(vn) ?? 0) + 1);
    const cn = fi.category_id ? cMap.get(fi.category_id)?.name : null;
    if (cn) filesByCatName.set(cn, (filesByCatName.get(cn) ?? 0) + 1);
  }
  const perVertical = rolled.perVertical.map((v) => ({ ...v, files: filesByVertName.get(v.name) ?? 0 }));
  const perCategory = rolled.perCategory.map((c) => ({ ...c, files: filesByCatName.get(c.name) ?? 0 }));

  // Group the real folders and files by their actual folder name, so the
  // assistant reports whatever folders truly exist. New folder types appear
  // here on their own with no code change.
  const folById = new Map<string, string>((folRows ?? []).map((f: { id: string; name: string }) => [f.id, f.name]));
  const typeFolders = new Map<string, number>();
  for (const f of (folRows ?? []) as { id: string; name: string }[]) {
    typeFolders.set(f.name, (typeFolders.get(f.name) ?? 0) + 1);
  }
  const typeFiles = new Map<string, number>();
  for (const fi of (filRows ?? []) as { folder_id: string | null }[]) {
    const name = fi.folder_id ? folById.get(fi.folder_id) : null;
    if (name) typeFiles.set(name, (typeFiles.get(name) ?? 0) + 1);
  }
  const folderTypes = [...new Set([...typeFolders.keys(), ...typeFiles.keys()])]
    .map((name) => ({ name, folders: typeFolders.get(name) ?? 0, files: typeFiles.get(name) ?? 0 }))
    .sort((a, b) => b.files - a.files || b.folders - a.folders)
    .slice(0, 20);

  return {
    categories: perCategory.length,
    verticals: perVertical.length,
    campaigns: verticalIds.length,
    folders: (folRows ?? []).length,
    files: (filRows ?? []).length,
    categoryNames: perCategory.map((c) => c.name).sort(),
    verticalNames: perVertical.map((v) => v.name).sort(),
    campaignTypeNames: (ctypes ?? []).map((t: { name: string }) => t.name),
    perVertical,
    perCategory,
    folderTypes,
    campaignsList,
    verticalsByCategory,
    scoped: !admin,
  };
}

/**
 * Answer list / name / scope questions straight from the real data in facts.
 * Runs whether or not AI is on, so "name 10 campaigns", "name the folders",
 * and "what do we have in insurance" always return actual names and numbers.
 * Returns null when the question is not a data-listing question.
 */
export function answerData(query: string, f: LibraryFacts): string | null {
  const q = query.toLowerCase().trim();
  const listish = /\b(name|names|list|show|which|what are|whats|give me|tell me)\b/.test(q);
  const num = () => { const m = q.match(/\b(\d{1,3})\b/); return m ? Math.min(60, Math.max(1, parseInt(m[1], 10))) : null; };

  const word = (name: string) => name.toLowerCase().split(/\s+/).some((w) => w.length >= 5 && q.includes(w));
  const vertFull = f.perVertical.find((v) => q.includes(v.name.toLowerCase()));
  const catFull = f.perCategory.find((c) => q.includes(c.name.toLowerCase()));
  const vert = vertFull ?? f.perVertical.find((v) => word(v.name));
  const cat = catFull ?? f.perCategory.find((c) => word(c.name));
  // Vertical is more specific than its category; prefer it when matched by full name.
  const scope = vertFull ? "vert" : catFull ? "cat" : vert ? "vert" : cat ? "cat" : null;

  // List / name campaigns, optionally scoped to a vertical or category.
  if (/campaign/.test(q) && (listish || /\d+\s*(of|campaign)/.test(q))) {
    let list = f.campaignsList;
    if (scope === "vert" && vert) list = list.filter((c) => c.vertical === vert.name);
    else if (scope === "cat" && cat) list = list.filter((c) => c.category === cat.name);
    if (!list.length) return null;
    const n = num() ?? 15;
    const names = list.slice(0, n).map((c) => c.name);
    const where = scope === "vert" && vert ? ` in ${vert.name}` : scope === "cat" && cat ? ` in ${cat.name}` : "";
    const more = list.length > names.length ? `, and ${list.length - names.length} more` : "";
    return `${list.length} campaign${list.length === 1 ? "" : "s"}${where}. Here ${names.length === 1 ? "is" : "are"} ${names.length}: ${names.join(", ")}${more}.`;
  }

  // List folders.
  if (/folder/.test(q) && listish) {
    const names = f.folderTypes.map((t) => t.name);
    if (!names.length) return null;
    return `The folders are: ${names.join(", ")}.`;
  }

  // List verticals, optionally within a category.
  if (/vertical/.test(q) && listish) {
    const names = scope === "cat" && cat ? (f.verticalsByCategory[cat.name] ?? []) : f.verticalNames;
    if (!names.length) return null;
    const where = scope === "cat" && cat ? ` in ${cat.name}` : "";
    return `${names.length} vertical${names.length === 1 ? "" : "s"}${where}: ${names.join(", ")}.`;
  }

  // List categories.
  if (/categor/.test(q) && listish) {
    if (!f.categoryNames.length) return null;
    return `The ${f.categories} categories are ${f.categoryNames.join(", ")}.`;
  }

  // "what do we have in <vertical/category>" / overview of a named area.
  if (scope && /(what.*(have|is|are)|inside|within|\bin\b|overview|summary|tell me about|breakdown)/.test(q)) {
    if (scope === "vert" && vert) {
      return `${vert.name} has ${vert.campaigns} campaign${vert.campaigns === 1 ? "" : "s"} and ${vert.files} file${vert.files === 1 ? "" : "s"}.`;
    }
    if (scope === "cat" && cat) {
      const vs = f.verticalsByCategory[cat.name] ?? [];
      const list = vs.length ? ` Its verticals: ${vs.join(", ")}.` : "";
      return `${cat.name} has ${cat.verticals} vertical${cat.verticals === 1 ? "" : "s"}, ${cat.campaigns} campaign${cat.campaigns === 1 ? "" : "s"}, and ${cat.files} file${cat.files === 1 ? "" : "s"}.${list}`;
    }
  }

  return null;
}

/** Compact facts block for the AI prompt. Includes per-vertical counts so the AI can quote real numbers. */
export function factsToString(f: LibraryFacts): string {
  const perV = f.perVertical.map((v) => `${v.name} (${v.campaigns} campaigns, ${v.files} files)`).join(", ");
  const perC = f.perCategory.map((c) => `${c.name} (${c.verticals} verticals, ${c.campaigns} campaigns, ${c.files} files)`).join(", ");
  const perF = f.folderTypes.map((t) => `${t.name} (${t.files} files)`).join(", ");
  const lines = [
    `${f.scoped ? "You can access" : "The library has"}: ${f.categories} categories, ${f.verticals} verticals, ${f.campaigns} campaigns, ${f.folders} folders${f.files ? `, ${f.files} files` : ""}.`,
    perC ? `Per category: ${perC}.` : "",
    perV ? `Per vertical: ${perV}.` : "",
    perF ? `Every campaign is organized into these folders (library-wide file totals): ${perF}.` : "",
    f.campaignTypeNames.length ? `Campaign types: ${f.campaignTypeNames.join(", ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/** Deterministic answer for count/list questions when AI is off. Runs on the real facts. */
export function deterministicAnswer(query: string, f: LibraryFacts): string {
  const q = query.toLowerCase().trim();
  const who = f.scoped ? "You can access" : "You have";

  // Greetings and "what can you do" — introduce the assistant.
  if (/^(hi|hello|hey|yo|hola|sup|greetings|good (morning|afternoon|evening))\b/.test(q)) {
    return `Hi. I help you find and count campaign assets. ${who} ${f.campaigns} campaigns across ${f.verticals} verticals. Try "agent scripts for auto insurance live transfer" or "how many campaigns in roofing".`;
  }
  if (/what can you do|help|how do you work|who are you|what are you/.test(q)) {
    return `I search the asset library and answer questions about it. Ask me to find assets (for example "data samples for final expense") and I link straight to the folder, or ask counts like "how many campaigns in auto insurance" or "what is in each folder".`;
  }

  // "what is inside each folder" — list the real folder types with file counts.
  if (f.folderTypes.length && /(inside|in each|each folder|what.*folder|folder.*have|contain|structure|organi[sz]ed)/.test(q)) {
    const list = f.folderTypes.map((t) => `${t.name} (${t.files} files)`).join(", ");
    return `Every campaign is organized into these folders, with the library-wide file counts: ${list}.`;
  }

  // Match a named vertical or category, by full name or a distinctive word
  // (so "how much data in bathroom" finds "Bathroom Remodeling").
  const nameHit = (name: string) => {
    const n = name.toLowerCase();
    if (q.includes(n)) return true;
    return n.split(/\s+/).some((w) => w.length >= 5 && q.includes(w));
  };
  const vHit = f.perVertical.find((v) => v.name && nameHit(v.name));
  if (vHit && /campaign|how many|total|number|file|asset|data|much/.test(q)) {
    return `${vHit.name} has ${vHit.files} file${vHit.files === 1 ? "" : "s"} across ${vHit.campaigns} campaign${vHit.campaigns === 1 ? "" : "s"}.`;
  }
  const cHit = f.perCategory.find((c) => c.name && nameHit(c.name));
  if (cHit && /campaign|vertical|how many|total|number|file|asset|data|much/.test(q)) {
    return `${cHit.name} has ${cHit.files} file${cHit.files === 1 ? "" : "s"} across ${cHit.campaigns} campaign${cHit.campaigns === 1 ? "" : "s"} in ${cHit.verticals} vertical${cHit.verticals === 1 ? "" : "s"}.`;
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

  // Build the match terms from the model's structured intent when it has any,
  // so conversational filler ("okay what do we have in …") never pollutes the
  // score. Only fall back to the raw query when the intent carries nothing.
  const structured = [intent.vertical, intent.campaign, intent.category, intent.asset_type, ...intent.keywords]
    .filter(Boolean)
    .join(" ");
  const basis = structured.trim() ? structured : query;
  const terms = new Set<string>([...expandTerms(basis), ...intent.keywords.map((k) => k.toLowerCase())]);
  terms.delete("");
  const aTokens = assetTokens(intent.asset_type);
  const assetToken = (intent.asset_type ?? "").toLowerCase();
  const qLc = query.toLowerCase().trim();
  // Tokens that describe the asset type, so they don't penalize a campaign that
  // holds the folder rather than naming it.
  const assetTerms = aTokens;

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
  if (aTokens.size && scored.length) {
    const { data: folders } = await db
      .from("folders")
      .select("id,name,campaign_id")
      .in("campaign_id", scored.map((x) => x.c.id));
    for (const f of (folders ?? []) as Folder[]) {
      if (!f.campaign_id || folderByCampaign.has(f.campaign_id)) continue;
      if (nameMatchesTokens(f.name, aTokens)) folderByCampaign.set(f.campaign_id, f);
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

/**
 * Find which accessible campaigns are missing a given asset type, by checking
 * each campaign's matching folder for at least one file. Runs real queries so
 * "what recordings are missing" gets a true answer, not a canned reply.
 */
export async function analyzeMissing(user: SessionUser, assetType: string | null, query = ""): Promise<GapReport | null> {
  const tokens = assetTokens(assetType).size ? assetTokens(assetType) : assetTokens(query);
  if (tokens.size === 0) return null;

  const db = supabaseAdmin();
  let allowed: Set<string> | null = null;
  if (!isAdmin(user)) {
    const scope = await accessScope(user.id);
    allowed = new Set(scope.campaignIds);
    if (allowed.size === 0) return { label: "", missing: [], have: 0, total: 0 };
  }

  const [{ data: camps }, { data: verts }, { data: cats }, { data: folders }, { data: files }] = await Promise.all([
    db.from("campaigns").select("id,name,vertical_id"),
    db.from("verticals").select("id,name,category_id"),
    db.from("categories").select("id,name"),
    db.from("folders").select("id,name,campaign_id"),
    db.from("files").select("folder_id").eq("status", "ready"),
  ]);

  // Resolve the target to the REAL folder names that match the asset tokens.
  const targetNames = new Set<string>();
  const nameFreq = new Map<string, number>();
  for (const fo of (folders ?? []) as Folder[]) {
    if (nameMatchesTokens(fo.name, tokens)) {
      targetNames.add(fo.name);
      nameFreq.set(fo.name, (nameFreq.get(fo.name) ?? 0) + 1);
    }
  }
  if (targetNames.size === 0) return null;
  // Label it by the most common matching folder name, e.g. "Verification Recordings".
  const label = [...nameFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const filesByFolder = new Map<string, number>();
  for (const f of (files ?? []) as { folder_id: string | null }[]) {
    if (f.folder_id) filesByFolder.set(f.folder_id, (filesByFolder.get(f.folder_id) ?? 0) + 1);
  }
  // A campaign "has" the asset when it owns a matching folder with >=1 file.
  const hasAsset = new Set<string>();
  for (const fo of (folders ?? []) as Folder[]) {
    if (!fo.campaign_id) continue;
    if (targetNames.has(fo.name) && (filesByFolder.get(fo.id) ?? 0) > 0) hasAsset.add(fo.campaign_id);
  }

  const vMap = new Map<string, Vert>((verts ?? []).map((v: Vert) => [v.id, v]));
  const cMap = new Map<string, Cat>((cats ?? []).map((c: Cat) => [c.id, c]));

  const missing: GapReport["missing"] = [];
  let have = 0, total = 0;
  for (const c of (camps ?? []) as Camp[]) {
    if (allowed && !allowed.has(c.id)) continue;
    total += 1;
    if (hasAsset.has(c.id)) { have += 1; continue; }
    const v = vMap.get(c.vertical_id);
    const cat = v ? cMap.get(v.category_id) : undefined;
    missing.push({ id: c.id, name: c.name, path: [cat?.name, v?.name, c.name].filter(Boolean).join("  ›  ") });
  }
  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { label, missing, have, total };
}
