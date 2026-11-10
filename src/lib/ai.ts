// AI intent layer for the Search Assistant. Turns a natural-language query into
// structured search intent. Rotates across the admin's keys and fails over
// Gemini <-> Groq. If no key works, falls back to a deterministic parser so the
// assistant never goes down. SERVER ONLY.
import { getAiSettings, pickKey, markKeyUsed, coolDownKey, modelList, DEFAULT_GEMINI_MODEL, type AiProvider } from "@/lib/ai-keys";

// The action the model chooses. The server runs the real query for it.
export type Action =
  | "search"          // find assets/campaigns to open
  | "list_campaigns"  // list campaign names (optionally scoped)
  | "list_folders"    // list the folder names
  | "list_verticals"  // list verticals (optionally in a category)
  | "list_categories" // list the categories
  | "area_summary"    // summarize a vertical or category
  | "missing"         // find campaigns missing an asset
  | "answer"          // answer from the facts (counts, yes/no, greeting, off-topic)
  | "clarify";        // ask one short question

/** One sub-request inside a multi-part search ("ACA landers + auto insurance recordings"). */
export interface SubRequest {
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  asset_type: string | null;
  keywords: string[];
}

export interface Intent {
  action: Action;
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  asset_type: string | null;
  limit: number | null;
  keywords: string[];
  reply: string | null;
  // For 'search': one entry per (vertical/campaign, asset) pair the user asked for.
  // A single-part search has one entry. The server runs a query for each.
  requests: SubRequest[];
}

export interface ParseResult {
  intent: Intent;
  usedAI: boolean;
  provider: AiProvider | null;
}

export function systemPrompt(taxonomy: string, facts: string): string {
  return [
    "You are the Wstorage assistant for a marketing-asset library.",
    "Act like a sharp, friendly human teammate. Be brief. One or two short sentences, never a wall of text.",
    "Prefer to act over to chat.",
    "",
    "Sound human, not scripted:",
    "- Answer the actual question first and directly. If asked 'why are you here', say it plainly.",
    "- Do NOT end messages with a stock offer like 'What are you looking for?' or 'What can I get",
    "  for you?'. Add a follow-up only when it genuinely helps, and word it differently each time.",
    "- Never repeat a sentence you already said. If the user repeats or pushes back, change your",
    "  wording and get more specific, the way a person would.",
    "- Do not pitch or over-explain what you do unless asked. Match the user's length and tone.",
    "- When asked how much data or how many assets something has, give the real number from the",
    "  facts (files per vertical or category), not a vague 'contains creatives and scripts'.",
    "",
    "Decide ONE action and fill its parameters. The server runs the real database",
    "query for the action you choose, so pick the one that fetches the right data.",
    "- 'search': the user wants to find or open assets or campaigns. Fill 'requests' with ONE",
    "  entry per thing they asked for. Each entry: vertical, campaign, category, asset_type,",
    "  keywords. If they ask for several assets or several verticals in one message, split it:",
    "  'ACA transfer lander, creatives and recordings' = 3 entries (ACA landing pages, ACA",
    "  creatives, ACA verification recordings). 'creatives from ACA and recordings from auto",
    "  insurance' = 2 entries. Treat 'ads previews' as creatives and 'lander' as landing pages;",
    "  do not add duplicate entries. Use exact vertical names from the taxonomy. A single ask",
    "  is one entry. reply = one short line of what you are pulling up.",
    "- 'list_campaigns': the user wants campaign names. Params: vertical or category to",
    "  scope to (optional), limit (a number if they asked for N, else null).",
    "- 'list_folders': the user wants the folder names.",
    "- 'list_verticals': the user wants the verticals. Param: category to scope (optional).",
    "- 'list_categories': the user wants the categories.",
    "- 'area_summary': the user wants an overview of one vertical or category (its",
    "  campaigns and files). Params: vertical OR category.",
    "- 'missing': the user wants to know which campaigns lack an asset. Param: asset_type.",
    "- 'answer': any other question answered from the facts (counts, how many, how much,",
    "  yes/no, what is in each folder, a greeting, or an off-topic redirect). Put the full",
    "  answer in reply using the real numbers and names. keywords [].",
    "- 'clarify': the request is too vague to act on (for example just 'live transfer').",
    "  Ask ONE short question naming concrete options. reply = the question. keywords [].",
    "",
    "For list and area actions, leave reply null; the server writes the list from real data.",
    "Map synonyms: car insurance = auto insurance, live calls = live transfer,",
    "old leads = aged leads, ads/banners/images = creatives, call scripts = agent scripts.",
    "Never invent folders, numbers, campaigns, or links. Use only the data below.",
    "",
    "Library facts (the current real data):",
    facts,
    "",
    "Taxonomy (categories > verticals, plus campaign types):",
    taxonomy,
    "",
    'Return ONLY JSON: {"action":"search"|"list_campaigns"|"list_folders"|"list_verticals"|',
    '"list_categories"|"area_summary"|"missing"|"answer"|"clarify","vertical":string|null,',
    '"campaign":string|null,"category":string|null,"asset_type":string|null,"limit":number|null,',
    '"keywords":string[],"reply":string|null,"requests":[{"vertical":string|null,',
    '"campaign":string|null,"category":string|null,"asset_type":string|null,"keywords":string[]}]}.',
  ].join("\n");
}

type ChatTurn = { role: "user" | "assistant"; content: string };

const ACTIONS: Action[] = ["search", "list_campaigns", "list_folders", "list_verticals", "list_categories", "area_summary", "missing", "answer", "clarify"];

export function normalize(raw: unknown): Intent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const kws = Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === "string").slice(0, 20) : [];
  // Accept the model's action; also tolerate a legacy "mode" field.
  const raw_action = (o.action ?? o.mode) as string | undefined;
  const action: Action = ACTIONS.includes(raw_action as Action) ? (raw_action as Action) : (str(o.reply) ? "answer" : "search");
  const limit = typeof o.limit === "number" && isFinite(o.limit) ? Math.min(60, Math.max(1, Math.round(o.limit))) : null;
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, 20) : []);

  // Sub-requests for a multi-part search. Capped so one message cannot fan out
  // into dozens of queries. Duplicates (same vertical/campaign/asset) are dropped.
  const requests: SubRequest[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.requests)) {
    for (const r of o.requests.slice(0, 8)) {
      const e = (r ?? {}) as Record<string, unknown>;
      const sub: SubRequest = {
        category: str(e.category), vertical: str(e.vertical), campaign: str(e.campaign),
        asset_type: str(e.asset_type), keywords: strList(e.keywords),
      };
      if (!sub.category && !sub.vertical && !sub.campaign && !sub.asset_type && !sub.keywords.length) continue;
      const key = [sub.vertical, sub.campaign, sub.category, sub.asset_type].map((x) => (x ?? "").toLowerCase()).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push(sub);
    }
  }
  const top = {
    category: str(o.category), vertical: str(o.vertical), campaign: str(o.campaign),
    asset_type: str(o.asset_type), keywords: kws,
  };
  // A search with no requests list is a single request from the top-level fields.
  if (!requests.length && action === "search") requests.push(top);

  return { action, ...top, limit, reply: str(o.reply), requests };
}

/** A reply with no usable intent counts as a failure, so the next model is tried. */
function requireIntentJson(o: unknown): unknown {
  const r = (o ?? {}) as Record<string, unknown>;
  if (!r.action && !r.mode && !r.reply && !r.requests) throw new Error("unusable model output");
  return o;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf("{");
    const e = t.lastIndexOf("}");
    if (s >= 0 && e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch { /* fall through */ }
    }
    return {};
  }
}

class RateLimit extends Error {}

async function callGemini(model: string, key: string, query: string, history: ChatTurn[], sys: string): Promise<unknown> {
  const contents = [
    ...history.slice(-6).map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: query }] },
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 512 },
      }),
    }
  );
  if (res.status === 429) throw new RateLimit("gemini rate limit");
  if (!res.ok) throw new Error(`gemini ${res.status}`);
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return requireIntentJson(extractJson(text));
}

async function callGroq(model: string, key: string, query: string, history: ChatTurn[], sys: string): Promise<unknown> {
  const messages = [
    { role: "system", content: sys },
    ...history.slice(-6).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: query },
  ];
  // Note: no response_format. Some Groq models (gpt-oss) reject strict JSON mode;
  // the prompt asks for JSON only and extractJson tolerates fences / stray text.
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      max_tokens: 512,
    }),
  });
  if (res.status === 429) throw new RateLimit("groq rate limit");
  if (!res.ok) throw new Error(`groq ${res.status}`);
  const j = await res.json();
  const text = j?.choices?.[0]?.message?.content ?? "{}";
  return requireIntentJson(extractJson(text));
}

/** Parse a query into intent, trying the admin's AI keys with failover, else deterministic. */
export async function parseIntent(query: string, history: ChatTurn[], taxonomy: string, facts: string): Promise<ParseResult> {
  const sys = systemPrompt(taxonomy, facts);
  let settings;
  try {
    settings = await getAiSettings();
  } catch {
    settings = { provider_order: ["gemini", "groq"] as AiProvider[], enabled: true, gemini_model: DEFAULT_GEMINI_MODEL, groq_model: "openai/gpt-oss-120b" };
  }

  if (settings.enabled) {
    for (const provider of settings.provider_order) {
      // For Gemini we try a chain of models with one key before cooling it, since
      // free-tier quota is per model: if gemma is exhausted, flash-lite may be free.
      const models = provider === "gemini" ? modelList(settings.gemini_model) : [settings.groq_model];
      // Try several keys of this provider; each spent key is skipped next time.
      for (let attempt = 0; attempt < 8; attempt++) {
        let picked: { id: string; key: string } | null = null;
        try {
          picked = await pickKey(provider);
        } catch {
          picked = null; // table missing or DB error -> treat as no keys
        }
        if (!picked) break;

        let rateLimited = false;
        for (const model of models) {
          try {
            const raw = provider === "gemini"
              ? await callGemini(model, picked.key, query, history, sys)
              : await callGroq(model, picked.key, query, history, sys);
            await markKeyUsed(picked.id);
            return { intent: normalize(raw), usedAI: true, provider };
          } catch (e) {
            // Rate-limited on this model: a different model on the same key may
            // still have quota, so keep going down the chain. Other errors
            // (bad model id, 503 overload) also just fall through to the next.
            if (e instanceof RateLimit) rateLimited = true;
          }
        }
        // Every model failed for this key. Cool it so the next attempt rotates.
        await coolDownKey(picked.id, rateLimited ? 90 : 15);
      }
    }
  }

  return { intent: deterministicIntent(query), usedAI: false, provider: null };
}

// ---- Deterministic fallback -------------------------------------------------
const STOP = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "on", "me", "i", "need",
  "want", "find", "get", "show", "some", "please", "my", "with", "give", "looking",
  "search", "campaign", "folder", "asset", "assets", "file", "files",
  // Conversational filler, so a chatty query still scores on its real nouns.
  "what", "whats", "do", "does", "we", "have", "has", "okay", "ok", "yes", "no",
  "here", "there", "this", "that", "these", "those", "is", "are", "was", "were",
  "can", "could", "would", "should", "will", "you", "your", "our", "us", "them",
  "they", "it", "about", "any", "all", "us", "hey", "hi", "hello", "please",
]);
const SYNONYMS: Record<string, string[]> = {
  "auto insurance": ["car insurance", "vehicle insurance", "auto"],
  "live transfer": ["live calls", "warm transfer", "live", "transfers"],
  "aged leads": ["old leads", "historical leads", "aged"],
  "creatives": ["ads", "banners", "images", "creative"],
  "agent scripts": ["call scripts", "sales scripts", "scripts"],
  "landing pages": ["landers", "lp", "landing"],
  "call recording": ["recordings", "verification recordings", "recording"],
};

/** Expand a query with known synonyms (used by both the parser and the search). */
export function expandTerms(text: string): string[] {
  const low = text.toLowerCase();
  const out = new Set<string>();
  for (const w of low.split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))) out.add(w);
  for (const [canonical, alts] of Object.entries(SYNONYMS)) {
    if (low.includes(canonical) || alts.some((a) => low.includes(a))) {
      canonical.split(" ").forEach((w) => out.add(w));
    }
  }
  return Array.from(out);
}

/** Does the query look like a question about the library rather than a search? */
export function looksLikeQuestion(query: string): boolean {
  return /\b(how many|how much|count|total|number of|list|what('| i)?s|which|do we have|are there|overview|summary|show me all)\b/i.test(query);
}

// Guess the asset type (which campaign folder) from the raw query, so folder
// deep-linking works even when no AI key is available.
const ASSET_MAP: [string, string[]][] = [
  ["creatives", ["creative", "ads", "banner", "image", "graphic", "ad preview"]],
  ["landing pages", ["landing", "lander", "lp"]],
  ["agent scripts", ["script", "pitch", "rebuttal"]],
  ["verification recordings", ["recording", "verification"]],
  ["data samples", ["data sample", "sample", "lead sample"]],
  ["tcpa & compliance", ["tcpa", "compliance", "consent", "disclosure"]],
];

/** Every asset type named in the query, in order, without duplicates. */
function guessAssetTypes(query: string): string[] {
  const q = query.toLowerCase();
  const found: string[] = [];
  for (const [label, keys] of ASSET_MAP) {
    if (keys.some((k) => new RegExp(`\\b${k}`).test(q)) && !found.includes(label)) found.push(label);
  }
  return found;
}

function deterministicIntent(query: string): Intent {
  // AI is down. Mark search vs answer and split out every asset type named, so
  // "ACA landers, creatives and recordings" still becomes three sub-requests.
  const assets = guessAssetTypes(query);
  const assetWords = new Set(ASSET_MAP.flatMap(([label, keys]) => [...label.split(/\W+/), ...keys]));
  // Shared context words (vertical, campaign type) for every sub-request.
  const context = expandTerms(query).filter((w) => !assetWords.has(w));
  const requests: SubRequest[] = assets.length
    ? assets.map((a) => ({ category: null, vertical: null, campaign: null, asset_type: a, keywords: context }))
    : [{ category: null, vertical: null, campaign: null, asset_type: null, keywords: expandTerms(query) }];
  return {
    action: looksLikeQuestion(query) ? "answer" : "search",
    category: null,
    vertical: null,
    campaign: null,
    asset_type: assets[0] ?? null,
    limit: null,
    keywords: expandTerms(query),
    reply: null,
    requests,
  };
}
