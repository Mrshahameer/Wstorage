// Keyword mode: used only when no AI model is reachable (no keys, quota used up,
// provider down, or AI turned off). It reads the same catalog and calls the same
// tools as the AI path, so results stay exact; only the wording is plainer.
import { campaignPath, type Catalog, type CatalogCampaign } from "./catalog";
import { foldersMentioned, matchesTypeWords, namesMentioned, norm, resolveFolder, typeWords } from "./match";
import type { ToolCall } from "./tools";
import type { Section } from "./types";

export type Plan =
  | { kind: "answer"; reply: string; sections?: Section[] }
  | { kind: "tools"; calls: ToolCall[] };

const GREETING = /^\s*(hi|hello|hey|yo|hola|salam|assalam|good (morning|afternoon|evening))\b/i;
const GAP = /\b(missing|without|lacks?|lacking|incomplete|gaps?|empty|(don'?t|do not|does not|doesn'?t) have)\b/i;
const COUNT = /\b(how many|how much|number of|count|total)\b/i;
const LIST = /\b(list|name|names|which|what are|show me all|all the)\b/i;
const STOP = new Set(["the", "and", "for", "from", "with", "give", "show", "find", "get", "need", "want", "please", "our", "their", "this", "that", "what", "have", "can", "you", "all", "any", "some", "file", "files"]);

const plural = (n: number, w: string) => `${n} ${n === 1 ? w : w.endsWith("y") ? `${w.slice(0, -1)}ies` : `${w}s`}`;
const cards = (label: string, camps: CatalogCampaign[]): Section => ({
  kind: "campaigns",
  label,
  campaigns: camps.slice(0, 40).map((c) => ({ id: c.id, name: c.name, path: campaignPath(c), link: `/library?campaignId=${c.id}`, note: plural(c.files, "file") })),
});

interface Seg { verts: string[]; cats: string[]; tw: string[]; folders: string[]; own: boolean }

/** Split a multi-part ask into parts, without breaking names that contain "and" or "&". */
function segments(catalog: Catalog, text: string): string[] {
  const protect = [...catalog.verticals.map((v) => v.name), ...catalog.categories, ...catalog.types, ...catalog.folderNames]
    .filter((n) => norm(n).includes(" "))
    .sort((a, b) => b.length - a.length);
  let s = text.toLowerCase();
  protect.forEach((name, i) => {
    const pat = norm(name).split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^a-z0-9]+");
    s = s.replace(new RegExp(pat, "g"), ` \u0000${i}\u0000 `);
  });
  return s
    .split(/\n|;|,|\band\b|\bplus\b|\balso\b|\b\d+[.)]\s/)
    .map((p) => p.replace(/\u0000(\d+)\u0000/g, (_, i) => protect[Number(i)]).trim())
    .filter(Boolean);
}

function pool(catalog: Catalog, verts: string[], cats: string[], tw: string[]): CatalogCampaign[] {
  let p = catalog.campaigns;
  if (verts.length) p = p.filter((c) => verts.includes(c.vertical));
  else if (cats.length) p = p.filter((c) => cats.includes(c.category));
  const typed = p.filter((c) => matchesTypeWords(c, tw));
  return typed.length ? typed : p;
}

function folderTotals(camps: CatalogCampaign[]): string {
  const m = new Map<string, number>();
  for (const c of camps) for (const f of c.folders) m.set(f.name, (m.get(f.name) ?? 0) + f.files);
  return [...m.entries()].filter(([, n]) => n > 0).map(([n, k]) => `${n} ${k}`).join(", ");
}

export function planFallback(catalog: Catalog, text: string): Plan {
  const t = text.trim();
  const tot = catalog.totals;
  const verts = namesMentioned(catalog.verticals.map((v) => v.name), t);
  const cats = verts.length ? [] : namesMentioned(catalog.categories, t);
  const folders = foldersMentioned(catalog.folderNames, t);
  const tw = typeWords(catalog.types, t);
  const where = verts.length ? ` in ${verts.join(", ")}` : cats.length ? ` in ${cats.join(", ")}` : "";

  if (GREETING.test(t) && t.split(/\s+/).length <= 6) {
    return { kind: "answer", reply: `Hi. You can access ${plural(tot.campaigns, "campaign")} across ${plural(tot.verticals, "vertical")}, with ${plural(tot.files, "file")}. Ask for assets like "ACA inbound landing pages", or ask what we have in a vertical.` };
  }

  if (GAP.test(t) && folders.length) {
    return { kind: "tools", calls: [{ name: "find_missing", args: { folder: folders[0], vertical: verts[0], category: cats[0] } }] };
  }

  // Counts ("how many landing pages in ACA") answer from the catalog directly.
  if (COUNT.test(t)) {
    const p = pool(catalog, verts, cats, tw);
    if (folders.length) {
      const f = folders[0];
      const n = p.reduce((s, c) => s + (resolveFolder(c.folders, f)?.files ?? 0), 0);
      return { kind: "answer", reply: `There ${n === 1 ? "is" : "are"} ${plural(n, "file")} in ${f}${where}, across ${plural(p.length, "campaign")}.` };
    }
    if (verts.length || cats.length || tw.length) {
      return { kind: "answer", reply: `${where ? where.slice(4) : "Those campaigns"}: ${plural(p.length, "campaign")} and ${plural(p.reduce((s, c) => s + c.files, 0), "file")}.` };
    }
    return { kind: "answer", reply: `You can access ${plural(tot.categories, "category")}, ${plural(tot.verticals, "vertical")}, ${plural(tot.campaigns, "campaign")}, ${plural(tot.folders, "folder")} and ${plural(tot.files, "file")}.` };
  }

  if (!folders.length) {
    if (/\bcampaigns?\b/i.test(t) && (LIST.test(t) || where || tw.length)) {
      const p = pool(catalog, verts, cats, tw);
      const n = Math.min(60, Number(t.match(/\b(\d{1,3})\b/)?.[1] ?? 20));
      const shown = p.slice(0, n);
      return { kind: "answer", reply: `${plural(p.length, "campaign")}${where}. Showing ${shown.length}.`, sections: [cards(`Campaigns${where}`, shown)] };
    }
    if (/\bfolders?\b/i.test(t) && LIST.test(t)) {
      return { kind: "answer", reply: `The folders are: ${catalog.folderNames.join(", ")}.` };
    }
    if (/\bverticals?\b/i.test(t)) {
      const vs = catalog.verticals.filter((v) => !cats.length || cats.includes(v.category)).map((v) => v.name);
      return { kind: "answer", reply: `${plural(vs.length, "vertical")}${cats.length ? ` in ${cats.join(", ")}` : ""}: ${vs.join(", ")}.` };
    }
    if (/\bcategor(y|ies)\b/i.test(t)) {
      return { kind: "answer", reply: `The categories are ${catalog.categories.join(", ")}.` };
    }
    if (verts.length || cats.length || tw.length) {
      const p = pool(catalog, verts, cats, tw);
      const files = p.reduce((s, c) => s + c.files, 0);
      const ft = folderTotals(p);
      return { kind: "answer", reply: `${where ? where.slice(4) : "Matching campaigns"}: ${plural(p.length, "campaign")}, ${plural(files, "file")}${ft ? ` (${ft})` : ""}.`, sections: [cards(`Campaigns${where}`, p)] };
    }
    const ws = norm(t).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
    if (ws.length) return { kind: "tools", calls: [{ name: "search_files", args: { text: ws.slice(0, 5).join(" ") } }] };
    return { kind: "answer", reply: "I could not tell what you need. Try a vertical and an asset, like 'ACA inbound landing pages'." };
  }

  // Asset retrieval, possibly multi-part: one get_assets item per campaign + folder.
  const segs: Seg[] = segments(catalog, t).map((s) => {
    const v = namesMentioned(catalog.verticals.map((x) => x.name), s);
    const c = v.length ? [] : namesMentioned(catalog.categories, s);
    return { verts: v, cats: c, tw: typeWords(catalog.types, s), folders: foldersMentioned(catalog.folderNames, s), own: v.length > 0 || c.length > 0 };
  });
  // A part without its own vertical uses the one named before it ("ACA landers,
  // creatives and recordings"), or the next one if it comes first.
  let prev: Seg | null = null;
  for (const s of segs) {
    if (s.own) prev = s;
    else if (prev) { s.verts = prev.verts; s.cats = prev.cats; if (!s.tw.length) s.tw = prev.tw; }
  }
  let next: Seg | null = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.own) next = s;
    else if (next && !s.verts.length && !s.cats.length) { s.verts = next.verts; s.cats = next.cats; if (!s.tw.length) s.tw = next.tw; }
  }

  const items: { campaign: string; folder: string }[] = [];
  for (const s of segs) {
    if (!s.folders.length || (!s.verts.length && !s.cats.length && !s.tw.length)) continue;
    for (const c of pool(catalog, s.verts, s.cats, s.tw).slice(0, 6)) for (const f of s.folders) items.push({ campaign: c.ref, folder: f });
  }
  const unique = [...new Map(items.map((i) => [`${i.campaign}|${i.folder}`, i])).values()].slice(0, 8);
  if (!unique.length) {
    return { kind: "answer", reply: `Which vertical or campaign should I pull ${folders.join(", ")} from? For example "ACA inbound".` };
  }
  return { kind: "tools", calls: [{ name: "get_assets", args: { items: unique } }] };
}
