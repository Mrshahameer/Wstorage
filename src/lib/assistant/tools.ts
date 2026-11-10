// The assistant's tools. The model chooses which to call and with which catalog
// refs; these functions run the real queries. Every ref is checked against the
// user's catalog, so the model can never reach a campaign the user cannot see,
// and a bad ref becomes a visible note instead of wrong data.
import { campaignPath, type Catalog, type CatalogCampaign, type CatalogFolder } from "./catalog";
import type { FileRow, FileSource } from "./data";
import { namesMentioned, norm, resolveFolder } from "./match";
import type { CampaignItem, FileItem, Section } from "./types";

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}
export interface ToolOutcome {
  sections: Section[]; // shown in the chat
  forModel: unknown; // compact summary the model reads to write its reply
}

const MAX_ITEMS = 8;
const FILES_PER_SECTION = 60;

export const TOOL_DECLARATIONS = [
  {
    name: "get_assets",
    description:
      "Fetch the actual files, with links, for one or more campaign + folder pairs. Use one item per thing the user asked for. For a multi-part ask, put every item in ONE call.",
    parameters: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "One entry per campaign + folder the user wants.",
          items: {
            type: "object",
            properties: {
              campaign: { type: "string", description: "Campaign REF from the catalog, for example C12." },
              folder: {
                type: "string",
                description: "Exact folder name from the catalog, for example Landing Pages. Omit to get every folder of the campaign.",
              },
            },
            required: ["campaign"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "find_missing",
    description:
      "List campaigns that have no files in a folder, for example which campaigns lack Verification Recordings. Optionally limit to a vertical or a category.",
    parameters: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Folder name from the catalog." },
        vertical: { type: "string", description: "Vertical name, optional." },
        category: { type: "string", description: "Category name, optional." },
      },
      required: ["folder"],
    },
  },
  {
    name: "search_files",
    description:
      "Find files by words in their file name, description or tags (not the file contents). Optionally limit to campaign refs.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Words to look for, for example 'shower 9x16'." },
        campaigns: { type: "array", items: { type: "string" }, description: "Campaign REFs to search within, optional." },
      },
      required: ["text"],
    },
  },
  {
    name: "show_campaigns",
    description: "Show campaigns as cards that open them in the library. Use when the user wants to see or open campaigns, not specific files.",
    parameters: {
      type: "object",
      properties: {
        campaigns: { type: "array", items: { type: "string" }, description: "Campaign REFs from the catalog." },
        title: { type: "string", description: "Short heading, for example 'ACA campaigns'." },
      },
      required: ["campaigns"],
    },
  },
];

function findCampaign(catalog: Catalog, value: unknown): CatalogCampaign | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const ref = catalog.byRef.get(v.toUpperCase());
  if (ref) return ref;
  const n = norm(v);
  return catalog.campaigns.find((c) => norm(c.name) === n) ?? null;
}

function toFileItem(r: FileRow, catalog: Catalog): FileItem {
  const idx = r.folder_id ? catalog.folderIndex.get(r.folder_id) : undefined;
  return {
    id: r.id,
    name: r.name,
    ext: r.extension,
    contentType: r.content_type,
    size: Number(r.size_bytes) || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: r.tags ?? [],
    liveUrl: r.live_url,
    folder: idx?.top.name ?? null,
  };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

async function getAssets(args: Record<string, unknown>, catalog: Catalog, src: FileSource): Promise<ToolOutcome> {
  const raw = Array.isArray(args.items) ? args.items : [];
  if (!raw.length) return { sections: [], forModel: { error: "items is required" } };
  const sections: Section[] = [];
  const out: unknown[] = [];
  const seen = new Set<string>();

  for (const it of raw.slice(0, MAX_ITEMS)) {
    const item = (it ?? {}) as Record<string, unknown>;
    const camp = findCampaign(catalog, item.campaign);
    if (!camp) {
      sections.push({ kind: "note", label: `Not found: ${String(item.campaign ?? "?")}`, text: "That campaign is not in the library, or you do not have access to it." });
      out.push({ campaign: item.campaign, error: "unknown campaign ref" });
      continue;
    }
    const wanted = typeof item.folder === "string" ? item.folder.trim() : "";
    let folder: CatalogFolder | null = null;
    if (wanted) {
      folder = resolveFolder(camp.folders, wanted);
      if (!folder) {
        const available = camp.folders.map((f) => f.name);
        sections.push({ kind: "note", label: `${camp.name} · ${wanted}`, text: `This campaign has no "${wanted}" folder. Its folders: ${available.join(", ") || "none"}.` });
        out.push({ campaign: camp.ref, folder: wanted, error: "no such folder", available });
        continue;
      }
    }
    const key = `${camp.id}|${folder?.id ?? "*"}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ids = folder ? folder.ids : camp.folders.flatMap((f) => f.ids);
    const { rows, total } = await src.byFolders(ids, FILES_PER_SECTION);
    const files = rows.map((r) => toFileItem(r, catalog));
    sections.push({
      kind: "files",
      label: folder ? `${camp.name} · ${folder.name}` : camp.name,
      path: campaignPath(camp),
      campaign: { id: camp.id, name: camp.name },
      folder: folder ? { id: folder.id, name: folder.name } : null,
      link: folder ? `/library?campaignId=${camp.id}&folderId=${folder.id}` : `/library?campaignId=${camp.id}`,
      files,
      total,
      note: total === 0 ? (folder ? `The ${folder.name} folder is empty.` : "This campaign has no files yet.") : undefined,
    });
    out.push({ campaign: `${camp.ref} ${camp.name}`, folder: folder?.name ?? "all folders", files: total, names: files.slice(0, 10).map((f) => f.name) });
  }
  return { sections, forModel: { results: out } };
}

function findMissing(args: Record<string, unknown>, catalog: Catalog): ToolOutcome {
  const wanted = String(args.folder ?? "").trim();
  if (!wanted) return { sections: [], forModel: { error: "folder is required" } };
  let pool = catalog.campaigns;
  const v = typeof args.vertical === "string" ? namesMentioned(catalog.verticals.map((x) => x.name), args.vertical) : [];
  const c = typeof args.category === "string" ? namesMentioned(catalog.categories, args.category) : [];
  if (v.length) pool = pool.filter((x) => v.includes(x.vertical));
  else if (c.length) pool = pool.filter((x) => c.includes(x.category));

  const missing: CampaignItem[] = [];
  const found = new Map<string, number>();
  for (const camp of pool) {
    const f = resolveFolder(camp.folders, wanted);
    if (f) found.set(f.name, (found.get(f.name) ?? 0) + 1);
    if (!f || f.files === 0) {
      missing.push({
        id: camp.id,
        name: camp.name,
        path: campaignPath(camp),
        link: f ? `/library?campaignId=${camp.id}&folderId=${f.id}` : `/library?campaignId=${camp.id}`,
        note: f ? `${f.name} is empty` : `no ${wanted} folder`,
      });
    }
  }
  if (pool.length && !found.size) {
    return {
      sections: [{ kind: "note", label: `No "${wanted}" folder`, text: `No campaign has a folder matching "${wanted}". Folders in use: ${catalog.folderNames.join(", ")}.` }],
      forModel: { error: "no folder with that name", folders: catalog.folderNames },
    };
  }
  const label = [...found.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? wanted;
  return {
    sections: [{
      kind: "campaigns",
      label: `Missing ${label} · ${missing.length} of ${plural(pool.length, "campaign")}`,
      campaigns: missing,
      note: missing.length === 0 ? `Every campaign checked has ${label}.` : undefined,
    }],
    forModel: { folder: label, checked: pool.length, missing: missing.length, campaigns: missing.slice(0, 40).map((m) => m.name) },
  };
}

async function searchFiles(args: Record<string, unknown>, catalog: Catalog, src: FileSource): Promise<ToolOutcome> {
  const text = String(args.text ?? "").trim();
  const ws = norm(text).split(" ").filter((w) => w.length >= 2);
  if (!ws.length) return { sections: [], forModel: { error: "text is required" } };
  const only = Array.isArray(args.campaigns) && args.campaigns.length
    ? new Set(args.campaigns.map((x) => findCampaign(catalog, x)?.id).filter((x): x is string => !!x))
    : null;

  const rows = await src.search(ws, 300);
  const scored = rows
    .map((r) => {
      const idx = r.folder_id ? catalog.folderIndex.get(r.folder_id) : undefined;
      if (!idx || (only && !only.has(idx.campaign.id))) return null; // not visible to this user
      const hay = norm(`${r.name} ${r.description ?? ""} ${(r.tags ?? []).join(" ")}`);
      return { r, camp: idx.campaign, hits: ws.filter((w) => hay.includes(w)).length };
    })
    .filter((x): x is { r: FileRow; camp: CatalogCampaign; hits: number } => !!x);
  const best = Math.max(0, ...scored.map((s) => s.hits));
  const keep = scored.filter((s) => s.hits >= Math.max(1, Math.min(best, Math.ceil(ws.length / 2)))).sort((a, b) => b.hits - a.hits);

  const groups = new Map<string, { camp: CatalogCampaign; rows: FileRow[] }>();
  for (const s of keep) (groups.get(s.camp.id) ?? groups.set(s.camp.id, { camp: s.camp, rows: [] }).get(s.camp.id)!).rows.push(s.r);
  const sections: Section[] = [...groups.values()].slice(0, MAX_ITEMS).map(({ camp, rows: rs }) => ({
    kind: "files" as const,
    label: `${camp.name} · matching "${text}"`,
    path: campaignPath(camp),
    campaign: { id: camp.id, name: camp.name },
    folder: null,
    link: `/library?campaignId=${camp.id}`,
    files: rs.slice(0, 20).map((r) => toFileItem(r, catalog)),
    total: rs.length,
  }));
  return {
    sections: sections.length ? sections : [{ kind: "note", label: `No files matching "${text}"`, text: "No file name, description or tag matched." }],
    forModel: { matches: keep.length, byCampaign: [...groups.values()].slice(0, MAX_ITEMS).map((g) => ({ campaign: g.camp.name, files: g.rows.slice(0, 8).map((r) => r.name) })) },
  };
}

function showCampaigns(args: Record<string, unknown>, catalog: Catalog): ToolOutcome {
  const refs = Array.isArray(args.campaigns) ? args.campaigns : [];
  const camps = [...new Map(refs.map((r) => findCampaign(catalog, r)).filter((c): c is CatalogCampaign => !!c).map((c) => [c.id, c])).values()].slice(0, 40);
  if (!camps.length) return { sections: [], forModel: { error: "no valid campaign refs" } };
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : plural(camps.length, "campaign");
  return {
    sections: [{
      kind: "campaigns",
      label: title,
      campaigns: camps.map((c) => ({ id: c.id, name: c.name, path: campaignPath(c), link: `/library?campaignId=${c.id}`, note: plural(c.files, "file") })),
    }],
    forModel: { shown: camps.map((c) => c.name) },
  };
}

export async function runTool(call: ToolCall, catalog: Catalog, src: FileSource): Promise<ToolOutcome> {
  try {
    switch (call.name) {
      case "get_assets": return await getAssets(call.args, catalog, src);
      case "find_missing": return findMissing(call.args, catalog);
      case "search_files": return await searchFiles(call.args, catalog, src);
      case "show_campaigns": return showCampaigns(call.args, catalog);
      default: return { sections: [], forModel: { error: `unknown tool ${call.name}` } };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sections: [{ kind: "note", label: "Lookup failed", text: "The library could not be read just now. Please try again." }], forModel: { error: msg } };
  }
}

/** A plain reply for results produced without the model (keyword mode, or a failed final step). */
export function summarizeSections(sections: Section[]): string {
  if (!sections.length) return "I could not find anything for that. Try naming the vertical and the asset, like 'ACA inbound landing pages'.";
  const part = (s: Section) => {
    if (s.kind === "files") return `${s.label}: ${s.total ? plural(s.total, "file") : "empty"}`;
    if (s.kind === "note") return `${s.label}: ${s.text}`;
    const m = /^Missing (.+) · (\d+) of (\d+) campaigns?$/.exec(s.label);
    if (m) return m[2] === "0" ? `Every campaign checked has ${m[1]}` : `${m[2]} of ${m[3]} campaigns are missing ${m[1]}`;
    return s.label;
  };
  return sections.length === 1 ? `${part(sections[0])}.` : `Here are ${sections.length} results. ${sections.map(part).join(". ")}.`;
}
