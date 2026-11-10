// The assistant's view of the library: every campaign the user can access, with
// its folders and real file counts. At this size (about 90 campaigns, 650
// folders, up to 2,000 files) the whole catalog fits in the model's context, so
// the model picks exact campaign refs and folder names instead of the server
// guessing from words. Everything is built from live data, so new campaigns,
// verticals and folder types appear with no code change.

export interface Rows {
  categories: { id: string; name: string }[];
  verticals: { id: string; name: string; category_id: string | null }[];
  campaignTypes: { id: string; name: string }[];
  campaigns: { id: string; name: string; vertical_id: string | null; campaign_type_id: string | null }[];
  folders: { id: string; name: string; parent_id: string | null; campaign_id: string | null; sort?: number | null }[];
  files: { folder_id: string | null }[]; // ready, non-archived files only
}

/** What a non-admin may see. null means admin (everything). */
export interface Scope {
  campaignIds: string[]; // full-campaign grants (category/vertical grants already expanded)
  folderIds: string[]; // folder grants, descendants included
}

export interface CatalogFolder {
  id: string;
  name: string;
  files: number;
  ids: string[]; // this folder plus its visible subfolders
}

export interface CatalogCampaign {
  ref: string; // C1, C2 … stable within one catalog build
  id: string;
  name: string;
  vertical: string;
  category: string;
  type: string | null;
  folders: CatalogFolder[];
  files: number;
}

export interface Catalog {
  campaigns: CatalogCampaign[];
  byRef: Map<string, CatalogCampaign>;
  byId: Map<string, CatalogCampaign>;
  folderIndex: Map<string, { campaign: CatalogCampaign; top: CatalogFolder }>;
  categories: string[];
  verticals: { name: string; category: string }[];
  types: string[];
  folderNames: string[]; // distinct top-level folder names, most common first
  totals: { categories: number; verticals: number; campaigns: number; folders: number; files: number };
  scoped: boolean;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

export function buildCatalog(rows: Rows, scope: Scope | null): Catalog {
  const cat = new Map(rows.categories.map((c) => [c.id, c.name]));
  const vert = new Map(rows.verticals.map((v) => [v.id, v]));
  const type = new Map(rows.campaignTypes.map((t) => [t.id, t.name]));
  const fullCamps = scope ? new Set(scope.campaignIds) : null;
  const grantedFolders = scope ? new Set(scope.folderIds) : null;

  const foldersByCampaign = new Map<string, Rows["folders"]>();
  const children = new Map<string, string[]>();
  for (const f of rows.folders) {
    if (f.campaign_id) (foldersByCampaign.get(f.campaign_id) ?? foldersByCampaign.set(f.campaign_id, []).get(f.campaign_id)!).push(f);
    if (f.parent_id) (children.get(f.parent_id) ?? children.set(f.parent_id, []).get(f.parent_id)!).push(f.id);
  }
  const filesPerFolder = new Map<string, number>();
  for (const f of rows.files) if (f.folder_id) filesPerFolder.set(f.folder_id, (filesPerFolder.get(f.folder_id) ?? 0) + 1);

  type Draft = Omit<CatalogCampaign, "ref">;
  const drafts: Draft[] = [];
  for (const c of rows.campaigns) {
    const fs = foldersByCampaign.get(c.id) ?? [];
    const full = !scope || fullCamps!.has(c.id);
    const visible = new Set(fs.filter((f) => full || grantedFolders!.has(f.id)).map((f) => f.id));
    if (!full && visible.size === 0) continue; // nothing here this user can see

    // A top folder is a visible folder whose parent is not visible (normally the
    // campaign's own resource folders). Its files include visible subfolders.
    const tops = fs
      .filter((f) => visible.has(f.id) && (!f.parent_id || !visible.has(f.parent_id)))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || byName(a, b));
    const folders: CatalogFolder[] = tops.map((t) => {
      const ids: string[] = [];
      const stack = [t.id];
      while (stack.length) {
        const id = stack.pop()!;
        if (!visible.has(id) || ids.includes(id)) continue;
        ids.push(id);
        stack.push(...(children.get(id) ?? []));
      }
      return { id: t.id, name: t.name, ids, files: ids.reduce((n, id) => n + (filesPerFolder.get(id) ?? 0), 0) };
    });

    const v = c.vertical_id ? vert.get(c.vertical_id) : undefined;
    drafts.push({
      id: c.id,
      name: c.name,
      vertical: v?.name ?? "Unassigned",
      category: (v?.category_id && cat.get(v.category_id)) || "Unassigned",
      type: (c.campaign_type_id && type.get(c.campaign_type_id)) || null,
      folders,
      files: folders.reduce((n, f) => n + f.files, 0),
    });
  }

  drafts.sort((a, b) => a.category.localeCompare(b.category) || a.vertical.localeCompare(b.vertical) || a.name.localeCompare(b.name));
  const campaigns: CatalogCampaign[] = drafts.map((d, i) => ({ ...d, ref: `C${i + 1}` }));

  const folderIndex = new Map<string, { campaign: CatalogCampaign; top: CatalogFolder }>();
  const folderFreq = new Map<string, number>();
  for (const c of campaigns) {
    for (const f of c.folders) {
      folderFreq.set(f.name, (folderFreq.get(f.name) ?? 0) + 1);
      for (const id of f.ids) folderIndex.set(id, { campaign: c, top: f });
    }
  }
  const verticals = new Map<string, string>();
  campaigns.forEach((c) => verticals.set(c.vertical, c.category));

  return {
    campaigns,
    byRef: new Map(campaigns.map((c) => [c.ref, c])),
    byId: new Map(campaigns.map((c) => [c.id, c])),
    folderIndex,
    categories: [...new Set(campaigns.map((c) => c.category))].sort(),
    verticals: [...verticals.entries()].map(([name, category]) => ({ name, category })).sort((a, b) => a.name.localeCompare(b.name)),
    types: [...new Set(campaigns.map((c) => c.type).filter((t): t is string => !!t))].sort(),
    folderNames: [...folderFreq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n),
    totals: {
      categories: new Set(campaigns.map((c) => c.category)).size,
      verticals: verticals.size,
      campaigns: campaigns.length,
      folders: folderIndex.size,
      files: campaigns.reduce((n, c) => n + c.files, 0),
    },
    scoped: !!scope,
  };
}

export const campaignPath = (c: CatalogCampaign) => `${c.category} › ${c.vertical} › ${c.name}`;

/** Compact text the model reads. About 30 tokens per campaign. */
export function catalogText(c: Catalog): string {
  const t = c.totals;
  const lines = [
    `${c.scoped ? "This user can access" : "The library has"}: ${t.categories} categories, ${t.verticals} verticals, ${t.campaigns} campaigns, ${t.folders} folders, ${t.files} files.`,
    `Folder names in use: ${c.folderNames.join(", ") || "none"}.`,
    `Campaign types: ${c.types.join(", ") || "none"}.`,
    "Campaigns, one per line: REF | campaign | category > vertical | type | files per folder (a folder not listed has no files).",
  ];
  for (const x of c.campaigns) {
    const counts = x.folders.filter((f) => f.files > 0).map((f) => `${f.name} ${f.files}`).join(", ");
    lines.push(`${x.ref} | ${x.name} | ${x.category} > ${x.vertical} | ${x.type ?? "-"} | ${x.files} files${counts ? `: ${counts}` : ""}`);
  }
  return lines.join("\n");
}
