// AI intent layer for the Search Assistant. Turns a natural-language query into
// structured search intent. Rotates across the admin's keys and fails over
// Gemini <-> Groq. If no key works, falls back to a deterministic parser so the
// assistant never goes down. SERVER ONLY.
import { getAiSettings, pickKey, markKeyUsed, coolDownKey, modelList, DEFAULT_GEMINI_MODEL, type AiProvider } from "@/lib/ai-keys";

export interface Intent {
  mode: "search" | "answer";
  category: string | null;
  vertical: string | null;
  campaign: string | null;
  asset_type: string | null;
  keywords: string[];
  reply: string | null;
}

export interface ParseResult {
  intent: Intent;
  usedAI: boolean;
  provider: AiProvider | null;
}

function systemPrompt(taxonomy: string, facts: string): string {
  return [
    "You are the Wstorage assistant for a marketing-asset library.",
    "You help users find campaign folders and assets, AND answer questions about the library.",
    "",
    "Decide the mode:",
    "- mode 'answer': the user asks a question you can answer from the Library facts below",
    "  (how many campaigns, what verticals exist, list categories, overviews, counts, yes/no).",
    "  Put the full answer in reply, using the real numbers and names. Set keywords to [].",
    "- mode 'search': the user wants to find or open a specific campaign, folder, or asset.",
    "  Fill vertical/campaign/asset_type/keywords. reply is one short line of what you are finding.",
    "",
    "Map synonyms: car insurance = auto insurance, live calls = live transfer,",
    "old leads = aged leads, ads/banners/images = creatives, call scripts = agent scripts.",
    "For a greeting or small talk, set mode 'answer', greet warmly in one line, and offer an",
    "example of what to ask. For 'what is in each folder' or how the library is organized, use",
    "the folder list in the facts and answer in mode 'answer'.",
    "If the message is unrelated to this library, set mode 'answer', keywords [], and politely",
    "redirect in reply. Stay professional and concise. Never invent folders, numbers, or links.",
    "",
    "Library facts (the current real data):",
    facts,
    "",
    "Taxonomy (categories > verticals, plus campaign types):",
    taxonomy,
    "",
    'Return ONLY JSON: {"mode":"search"|"answer","category":string|null,"vertical":string|null,',
    '"campaign":string|null,"asset_type":string|null,"keywords":string[],"reply":string|null}.',
  ].join("\n");
}

type ChatTurn = { role: "user" | "assistant"; content: string };

function normalize(raw: unknown): Intent {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const kws = Array.isArray(o.keywords) ? o.keywords.filter((k): k is string => typeof k === "string").slice(0, 20) : [];
  return {
    mode: o.mode === "answer" ? "answer" : "search",
    category: str(o.category),
    vertical: str(o.vertical),
    campaign: str(o.campaign),
    asset_type: str(o.asset_type),
    keywords: kws,
    reply: str(o.reply),
  };
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
  return extractJson(text);
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
  return extractJson(text);
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
function guessAssetType(query: string): string | null {
  const q = query.toLowerCase();
  const map: [string, string[]][] = [
    ["creatives", ["creative", "ad", "ads", "banner", "image", "graphic"]],
    ["landing pages", ["landing", "lander", "lp"]],
    ["agent scripts", ["script", "scripts", "pitch", "rebuttal"]],
    ["verification recordings", ["recording", "recordings", "verification"]],
    ["data samples", ["data sample", "sample", "samples", "lead sample"]],
    ["tcpa & compliance", ["tcpa", "compliance", "consent", "disclosure"]],
  ];
  for (const [label, keys] of map) {
    if (keys.some((k) => q.includes(k))) return label;
  }
  return null;
}

function deterministicIntent(query: string): Intent {
  return {
    mode: looksLikeQuestion(query) ? "answer" : "search",
    category: null,
    vertical: null,
    campaign: null,
    asset_type: guessAssetType(query),
    keywords: expandTerms(query),
    reply: null,
  };
}
