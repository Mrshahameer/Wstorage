// Pure text-to-data matching used by the tools and the no-AI fallback. Every
// match is made against the REAL names in the catalog, so new verticals, types
// and folder types work with no code change. The only fixed knowledge is a
// short list of common phrasings for asset folders (lander = landing page).

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);

// Common ways people name an asset folder, mapped to a fragment of the folder name.
const FOLDER_HINTS: [RegExp, string][] = [
  [/\b(lander|landers|lp|lps|landing|landings)\b/, "landing"],
  [/\b(ads?|ad previews?|banners?|images?|graphics?|creatives?)\b/, "creative"],
  [/\b(recordings?|audio|verifications?)\b/, "recording"],
  [/\b(scripts?|pitch|pitches|rebuttals?)\b/, "script"],
  [/\b(samples?|lead data)\b/, "sample"],
  [/\b(tcpa|compliance|consent|consents|disclosure|disclosures)\b/, "compliance"],
  [/\bother assets?\b/, "other"],
];
// Words too common to identify a folder on their own.
const GENERIC = new Set(["other", "asset", "assets", "file", "files", "page", "pages", "data", "folder", "folders", "and"]);

/** Resolve one folder phrase ("lander", "Call recording") to a real folder of a campaign. */
export function resolveFolder<T extends { name: string }>(folders: T[], wanted: string): T | null {
  const w = norm(wanted);
  if (!w) return null;
  const exact = folders.find((f) => norm(f.name) === w);
  if (exact) return exact;
  for (const [re, frag] of FOLDER_HINTS) {
    if (re.test(w)) {
      const hit = folders.find((f) => norm(f.name).includes(frag));
      if (hit) return hit;
    }
  }
  const ww = words(w).filter((x) => x.length >= 4 && !GENERIC.has(x));
  return folders.find((f) => ww.some((x) => norm(f.name).includes(x))) ?? null;
}

/** Folder names (from the catalog) mentioned anywhere in the text, in order of appearance. */
export function foldersMentioned(folderNames: string[], text: string): string[] {
  const t = norm(text);
  const hits: { name: string; at: number }[] = [];
  for (const name of folderNames) {
    const n = norm(name);
    let at = t.indexOf(n);
    if (at < 0) {
      for (const [re, frag] of FOLDER_HINTS) {
        const m = re.exec(t);
        if (m && n.includes(frag)) { at = m.index; break; }
      }
    }
    if (at < 0) {
      for (const x of words(name)) {
        if (x.length >= 4 && !GENERIC.has(x)) {
          const i = t.search(new RegExp(`\\b${x}`));
          if (i >= 0) { at = i; break; }
        }
      }
    }
    if (at >= 0) hits.push({ name, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.name);
}

/**
 * Names (verticals or categories) mentioned in the text. Full names win and
 * the longest wins inside an overlap ("auto insurance web leads" beats "auto
 * insurance"). Otherwise a word that only one name has ("aca") identifies it.
 */
export function namesMentioned(names: string[], text: string): string[] {
  const t = ` ${norm(text)} `;
  const spans: { name: string; s: number; e: number }[] = [];
  for (const name of names) {
    const n = norm(name);
    if (!n) continue;
    const i = t.indexOf(` ${n} `);
    if (i >= 0) spans.push({ name, s: i, e: i + n.length });
  }
  const full = spans.filter((a) => !spans.some((b) => b !== a && b.s <= a.s && b.e >= a.e && b.e - b.s > a.e - a.s));
  if (full.length) return full.sort((a, b) => a.s - b.s).map((x) => x.name);

  const freq = new Map<string, number>();
  for (const name of names) for (const x of new Set(words(name))) freq.set(x, (freq.get(x) ?? 0) + 1);
  const out: string[] = [];
  for (const name of names) {
    if (words(name).some((x) => x.length >= 3 && freq.get(x) === 1 && !GENERIC.has(x) && t.includes(` ${x} `))) out.push(name);
  }
  return out;
}

// Short forms for campaign types.
const TYPE_ALIASES: [RegExp, string][] = [
  [/\blt\b/, "live transfer"],
  [/\bwt\b/, "warm transfer"],
  [/\binbounds\b/, "inbound"],
  [/\btransfers\b/, "transfer"],
];

/**
 * Campaign-type words in the text ("live transfer", "inbound", "warm"). A
 * campaign matches when ALL returned words appear in its name or type, so
 * "live transfer" excludes warm transfer while "transfer" keeps both.
 */
export function typeWords(types: string[], text: string): string[] {
  let t = ` ${norm(text)} `;
  for (const [re, rep] of TYPE_ALIASES) t = t.replace(re, rep);
  const vocab = new Set<string>();
  for (const ty of types) for (const x of words(ty)) if (x.length >= 4) vocab.add(x);
  return [...vocab].filter((x) => t.includes(` ${x} `));
}

export function matchesTypeWords(c: { name: string; type: string | null }, tw: string[]): boolean {
  if (!tw.length) return true;
  const hay = ` ${norm(c.name)} ${norm(c.type ?? "")} `;
  return tw.every((x) => hay.includes(` ${x} `));
}
